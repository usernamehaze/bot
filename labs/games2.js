/* Games (v230): Animal habitats, World jigsaw, Landform match, History in order, Shape sorter and History dress-up.
   Four of them are "tap a thing, then tap where it goes" (dragging works too); the jigsaw drags continents onto the map. */
import { INK, FAINT, el, esc, canvas, drag, group, seg, button, row, stats, fmtTime, shuffle } from './kit.js';
import { loadWorld } from './puzzles.js';

const rand = Math.random;
function say(t) { try { const s = window.speechSynthesis; if (!s || !window.SpeechSynthesisUtterance) return; s.cancel(); const u = new SpeechSynthesisUtterance(t); u.rate = 0.9; s.speak(u); } catch (e) { /* no voice */ } }

/* ---------- a matching board: tap (or drag) an item, then tap the place it belongs ---------- */
// items: [{ id, html, label, to, why }], places: [{ id, html, label }]. onRight(item), onWrong(item, place), onDone()
function matchBoard(stage, { items, places, cls = '', onRight, onWrong, onDone }) {
  stage.querySelectorAll('.mt-board').forEach((x) => x.remove());
  const board = el('div', 'mt-board ' + cls); stage.appendChild(board);
  const tray = el('div', 'mt-tray'); tray.setAttribute('role', 'group'); tray.setAttribute('aria-label', 'Things to place');
  const bins = el('div', 'mt-bins');
  board.append(tray, bins);
  let picked = null;
  const left = new Set(items.map((x) => x.id));
  const itemBtn = new Map(), binEl = new Map();
  items.forEach((it) => {
    const b = el('button', 'mt-item', it.html); b.type = 'button'; b.dataset.item = it.id; b.setAttribute('aria-label', it.label); b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => { if (b._dragged) { b._dragged = false; return; } pick(it.id); });
    // drag it onto a place
    b.addEventListener('pointerdown', (e) => {
      const sx = e.clientX, sy = e.clientY; let moved = false, ghost = null;
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
        if (!moved) { moved = true; pick(it.id, true); ghost = el('div', 'mt-ghost', it.html); document.body.appendChild(ghost); }
        ghost.style.transform = `translate(${ev.clientX - 30}px, ${ev.clientY - 30}px)`;
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
        if (!moved) return;
        b._dragged = true; if (ghost) ghost.remove();
        const t = document.elementFromPoint(ev.clientX, ev.clientY), bin = t && t.closest('.mt-bin');
        if (bin && board.contains(bin)) drop(bin.dataset.place); else setTimeout(() => { b._dragged = false; }, 0);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    });
    tray.appendChild(b); itemBtn.set(it.id, b);
  });
  places.forEach((p) => {
    const d = el('button', 'mt-bin', `<span class="mt-bin-head">${p.html}</span><span class="mt-bin-got"></span>`); d.type = 'button'; d.dataset.place = p.id; d.setAttribute('aria-label', p.label);
    d.addEventListener('click', () => drop(p.id));
    bins.appendChild(d); binEl.set(p.id, d);
  });
  function pick(id, quiet) {
    picked = picked === id && !quiet ? null : id;
    itemBtn.forEach((b, k) => b.setAttribute('aria-pressed', String(k === picked)));
    board.classList.toggle('mt-picking', !!picked);
  }
  function drop(placeId) {
    if (!picked) return;
    const it = items.find((x) => x.id === picked), b = itemBtn.get(picked), bin = binEl.get(placeId);
    if (it.to === placeId) {
      left.delete(it.id); b.remove(); const got = el('span', 'mt-got', it.html); got.title = it.label; bin.querySelector('.mt-bin-got').appendChild(got);
      bin.classList.remove('mt-no'); void bin.offsetWidth; bin.classList.add('mt-yes'); picked = null; board.classList.remove('mt-picking');
      onRight && onRight(it);
      if (!left.size) onDone && onDone();
    } else {
      bin.classList.remove('mt-no'); void bin.offsetWidth; bin.classList.add('mt-no');
      onWrong && onWrong(it, places.find((p) => p.id === placeId));
    }
  }
  return { board, left: () => left.size };
}

/* ---------------- Animal habitats ---------------- */
export const HABITATS = { polar: ['❄️', 'Polar ice and snow'], desert: ['🏜️', 'Desert'], forest: ['🌳', 'Rainforest'], ocean: ['🌊', 'Ocean'], grass: ['🌾', 'Grassland'], wet: ['🪷', 'Pond and wetland'] };
export const ANIMALS = [
  ['polarbear', '🐻‍❄️', 'Polar bear', 'polar', 'Thick fur and a layer of fat keep a polar bear warm on the Arctic ice.'],
  ['penguin', '🐧', 'Penguin', 'polar', 'Emperor penguins huddle together on the Antarctic ice to stay warm.'],
  ['camel', '🐫', 'Camel', 'desert', 'A camel can go days without drinking, and its wide feet don’t sink in the sand.'],
  ['scorpion', '🦂', 'Scorpion', 'desert', 'Scorpions hide under rocks in the hot day and hunt in the cool night.'],
  ['monkey', '🐒', 'Monkey', 'forest', 'Monkeys climb and swing through the tall rainforest trees, eating fruit and leaves.'],
  ['parrot', '🦜', 'Parrot', 'forest', 'Parrots eat the fruits and nuts of the rainforest, and their bright colours hide among the flowers.'],
  ['whale', '🐋', 'Whale', 'ocean', 'Whales live their whole lives in the sea, coming up to breathe air.'],
  ['octopus', '🐙', 'Octopus', 'ocean', 'An octopus hides in rocks on the sea floor and can change colour.'],
  ['lion', '🦁', 'Lion', 'grass', 'Lions live in the grasslands of Africa, where their sandy colour hides them in the dry grass.'],
  ['zebra', '🦓', 'Zebra', 'grass', 'Zebras eat grass and live in big herds on the open plains.'],
  ['frog', '🐸', 'Frog', 'wet', 'Frogs lay their eggs in water, and tadpoles grow up in ponds.'],
  ['carabao', '🐃', 'Carabao', 'wet', 'A carabao (water buffalo) cools off by wallowing in mud and water, in wetlands and rice fields.'],
];
const habitatsLab = {
  id: 'habitats', name: 'Animal habitats', subject: 'games', levels: ['pre', 'elem'],
  blurb: 'Help each animal find its home: polar ice, desert, rainforest, ocean, grassland or pond.',
  words: 'animals habitats homes biomes ecosystems polar desert rainforest ocean grassland pond wetland matching game little ones science',
  icon: '<path d="M8 40c4-10 10-16 16-16s12 6 16 16z"/><circle cx="34" cy="12" r="5"/><path d="M14 22c0-4 3-7 6-7"/>',
  tries: ['Put an animal in its home', 'Sort every animal in a round', 'Finish a round with no wrong taps'],
  about: 'Tap an animal, then tap its home (or drag it there). Each round has six animals, one for each home. A wrong tap is fine: Cassie says why that home doesn’t fit, and you try again.\nA habitat is the place where an animal finds its food, water and shelter, and its body is suited to it.',
  mount({ stage, panel, api }) {
    let right = 0, wrong = 0, rounds = 0;
    stage.classList.add('kid-stage');
    const msg = el('p', 'gm-msg', 'Tap an animal, then tap its home.'); msg.setAttribute('aria-live', 'polite');
    const st = stats(panel);
    panel.appendChild(msg);
    button(row(panel, 'lab-row-btns'), 'New animals', () => deal(), 'main');
    function deal() {
      wrong = 0;
      const pickOne = (h) => shuffle(ANIMALS.filter((a) => a[3] === h), rand)[0];
      const set = Object.keys(HABITATS).map(pickOne);
      matchBoard(stage, {
        items: shuffle(set, rand).map(([id, e, name, to, why]) => ({ id, html: `<span class="mt-emoji" aria-hidden="true">${e}</span><span class="mt-name">${esc(name)}</span>`, label: name, to, why })),
        places: Object.entries(HABITATS).map(([id, [e, name]]) => ({ id, html: `<span class="mt-emoji" aria-hidden="true">${e}</span><span class="mt-name">${esc(name)}</span>`, label: name })),
        cls: 'mt-kids',
        onRight: (it) => { right++; msg.className = 'gm-msg good'; msg.textContent = `Yes! ${it.why}`; say(`Yes! ${it.why}`); api.check(0); report(); },
        onWrong: (it, p) => { wrong++; msg.className = 'gm-msg bad'; msg.textContent = `Not the ${p.label.toLowerCase()}. Where would a ${it.label.toLowerCase()} find its food and shelter?`; say(`Not there. Try again!`); report(); },
        onDone: () => { rounds++; api.check(1); if (!wrong) api.check(2); const b = api.best(6 - wrong, `${6 - wrong} of 6 first time`); msg.className = 'gm-msg good'; msg.textContent = `Every animal is home! ${wrong ? `${wrong} wrong ${wrong === 1 ? 'tap' : 'taps'} on the way.` : 'Not one wrong tap!'}${b && b.isNew ? ' A new best!' : ''} Press New animals to play again.`; report(); },
      });
      msg.className = 'gm-msg'; msg.textContent = 'Tap an animal, then tap its home.'; report();
    }
    function report() { st.set([['Right', String(right)], ['Wrong taps this round', String(wrong)], ['Rounds done', String(rounds)]]); }
    deal();
    return { state: () => `sorting animals into their habitats: ${right} placed, ${wrong} wrong taps this round, ${rounds} rounds done`, destroy: () => { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* */ } } };
  },
};

/* ---------------- World jigsaw ---------------- */
export const CONTINENTS = { na: 'North America', sa: 'South America', eu: 'Europe', af: 'Africa', as: 'Asia', oc: 'Oceania' };
// a point well inside each piece (lon, lat), to tap when placing it
export const HOME_POINT = { na: [-100, 45], sa: [-58, -12], eu: [42, 56], af: [20, 5], as: [100, 34], oc: [134, -25] };
const NO_ID = { 'N. Cyprus': 'as', Somaliland: 'af', Kosovo: 'eu' };
const contOf = (c) => (c.reg === 'Americas' ? (c.sub === 'South America' ? 'sa' : 'na') : { Africa: 'af', Europe: 'eu', Asia: 'as', Oceania: 'oc' }[c.reg] || null);
const LAT_TOP = 84, LAT_BOT = -57;
const jigsawLab = {
  id: 'jigsaw', name: 'World jigsaw', subject: 'games', levels: ['elem', 'hs'],
  blurb: 'Six continents are scattered. Drag each one back to its place on the world map, against the clock.',
  words: 'world map jigsaw puzzle continents africa asia europe north america south america oceania australia geography game',
  icon: '<path d="M6 12h14v8h-4v6h-10zM24 10h18v10h-6v8h-12z"/><path d="M10 30h10v8h-10zM26 32h14v6h-14z"/>',
  tries: ['Put one continent in its place', 'Finish the whole world map', 'Finish it in under 2 minutes'],
  about: 'Drag a continent to where it belongs; close enough and it clicks into place. Or choose a continent below and tap where it goes on the map.\nThe pieces are made from the countries in each continent (Natural Earth, 1:110m). Russia is in both Europe and Asia; here, as in the country list it comes from, it is part of the Europe piece. Antarctica is left out. The map uses a simple projection where longitude and latitude are straight lines, so lands near the poles look wider than they are.',
  mount({ stage, panel, api }) {
    let pieces = null, sel = 'af', t0 = 0, done = false, bad = 0, timer = 0, dragging = null, endSecs = 0;
    const msg = el('p', 'gm-msg', 'Loading the map…'); msg.setAttribute('aria-live', 'polite');
    const geo = (w, h) => { const mw = Math.min(w - 20, (h - 20) * 2), mh = mw / 2.0, x0 = (w - mw) / 2, y0 = (h - mh) / 2; return { mw, mh, x0, y0 }; };
    const proj = (G, lon, lat) => [G.x0 + ((lon + 180) / 360) * G.mw, G.y0 + ((LAT_TOP - lat) / (LAT_TOP - LAT_BOT)) * G.mh];
    let cache = { w: 0, h: 0, paths: {} };
    function paths(w, h) {
      if (cache.w === w && cache.h === h) return cache.paths;
      const G = geo(w, h), out = {};
      for (const k of Object.keys(CONTINENTS)) {
        const p = new Path2D();
        pieces[k].polys.forEach((poly) => poly.forEach((ring) => { let prev = null, shift = 0; ring.forEach(([lon, lat], i) => { if (prev !== null) { const d = lon + shift - prev; if (d > 180) shift -= 360; else if (d < -180) shift += 360; } prev = lon + shift; const [x, y] = proj(G, lon + shift, Math.max(LAT_BOT, lat)); if (i) p.lineTo(x, y); else p.moveTo(x, y); }); p.closePath(); })); // (rings that cross the 180° line are unwrapped, not drawn across the map)
        out[k] = p;
      }
      cache = { w, h, paths: out };
      return out;
    }
    const COL = { na: '#ff9a5c', sa: '#7fe0a8', eu: '#7fb2ff', af: '#ffcf5a', as: '#c4a0ff', oc: '#6fe3e0' };
    const cv = canvas(stage, (ctx, w, h) => {
      if (!pieces) return;
      const G = geo(w, h), P = paths(w, h);
      cv.c.dataset.map = JSON.stringify([G.x0, G.y0, G.mw, G.mh]);
      ctx.fillStyle = 'rgba(80,140,220,.12)'; ctx.fillRect(G.x0, G.y0, G.mw, G.mh);
      ctx.strokeStyle = FAINT; ctx.lineWidth = 1; ctx.strokeRect(G.x0, G.y0, G.mw, G.mh);
      // the empty spaces
      for (const k of Object.keys(CONTINENTS)) if (!pieces[k].placed) { ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fill(P[k]); ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.setLineDash([4, 4]); ctx.stroke(P[k]); ctx.setLineDash([]); }
      // placed first, then the loose pieces on top
      const order = Object.keys(CONTINENTS).sort((a, b) => (pieces[a].placed ? 0 : 1) - (pieces[b].placed ? 0 : 1) || (a === dragging ? 1 : 0) - (b === dragging ? 1 : 0));
      for (const k of order) {
        const pc = pieces[k]; ctx.save(); ctx.translate(pc.dx * G.mw, pc.dy * G.mh);
        ctx.fillStyle = COL[k]; ctx.globalAlpha = pc.placed ? 0.9 : 0.95; ctx.fill(P[k]); ctx.globalAlpha = 1;
        ctx.strokeStyle = k === sel && !pc.placed ? INK : 'rgba(0,0,0,.4)'; ctx.lineWidth = k === sel && !pc.placed ? 2.5 : 1; ctx.stroke(P[k]);
        ctx.restore();
        if (!pc.placed) { const [hx, hy] = proj(G, ...HOME_POINT[k]); const tx = hx + pc.dx * G.mw, ty = hy + pc.dy * G.mh; ctx.font = '700 12px system-ui, sans-serif'; ctx.fillStyle = 'rgba(16,17,22,.8)'; const tw = ctx.measureText(CONTINENTS[k]).width; ctx.fillRect(tx - tw / 2 - 5, ty - 11, tw + 10, 18); ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.fillText(CONTINENTS[k], tx, ty + 2); ctx.textAlign = 'left'; }
      }
    });
    const hitPiece = (p) => { const P = paths(cv.w, cv.h), G = geo(cv.w, cv.h), ctx = cv.ctx; const keys = Object.keys(CONTINENTS).filter((k) => !pieces[k].placed).reverse(); for (const k of keys) { const pc = pieces[k]; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); const inside = ctx.isPointInPath(P[k], p.x - pc.dx * G.mw, p.y - pc.dy * G.mh); ctx.restore(); if (inside) return k; } return null; };
    let grab = null;
    drag(cv.c, {
      down: (p) => { if (!pieces || done) return true; const k = hitPiece(p); grab = { k, x: p.x, y: p.y, dx: k ? pieces[k].dx : 0, dy: k ? pieces[k].dy : 0, moved: false }; return true; },
      move: (p) => {
        if (!grab || !grab.k) return;
        if (!grab.moved && Math.hypot(p.x - grab.x, p.y - grab.y) < 6) return;
        if (!grab.moved) { grab.moved = true; start(); dragging = grab.k; sel = grab.k; segC.set(grab.k); }
        const G = geo(cv.w, cv.h); pieces[grab.k].dx = grab.dx + (p.x - grab.x) / G.mw; pieces[grab.k].dy = grab.dy + (p.y - grab.y) / G.mh; cv.redraw();
      },
      // a drag drops the piece (it clicks in when close to home); a tap places the chosen continent there
      up: () => { if (!grab) return; const g = grab; grab = null; dragging = null; if (g.moved) { const pc = pieces[g.k]; if (Math.hypot(pc.dx, pc.dy * 0.5) < 0.05) place(g.k); } else tapPlace(g); cv.redraw(); },
    });
    function tapPlace(p) {
      if (!sel || pieces[sel].placed) return;
      start();
      const P = paths(cv.w, cv.h), ctx = cv.ctx; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); const ok = ctx.isPointInPath(P[sel], p.x, p.y); ctx.restore();
      if (ok) place(sel); else { bad++; msg.className = 'gm-msg bad'; msg.textContent = `${CONTINENTS[sel]} doesn’t go there. Look at its shape and try again.`; report(); }
    }
    function start() { if (!t0) { t0 = Date.now(); clearInterval(timer); timer = setInterval(report, 1000); } }
    function place(k) {
      const pc = pieces[k]; pc.dx = 0; pc.dy = 0; pc.placed = true; api.check(0);
      msg.className = 'gm-msg good'; msg.textContent = `${CONTINENTS[k]} is in place!`;
      const next = Object.keys(CONTINENTS).find((x) => !pieces[x].placed);
      if (next) { sel = next; segC.set(next); }
      else { done = true; clearInterval(timer); const secs = (Date.now() - t0) / 1000; endSecs = secs; api.check(1); if (secs < 120) api.check(2); const b = api.best(-Math.round(secs), `the world in ${fmtTime(secs)}`); msg.textContent = `The whole world in ${fmtTime(secs)}!${b && b.isNew ? ' A new best time!' : ''} Press Mix them up to play again.`; }
      report(); cv.redraw();
    }
    function mix() {
      for (const k of Object.keys(CONTINENTS)) { let dx = 0, dy = 0; while (Math.hypot(dx, dy * 0.5) < 0.12) { dx = (rand() - 0.5) * 0.7; dy = (rand() - 0.5) * 0.5; } Object.assign(pieces[k], { dx, dy, placed: false }); }
      t0 = 0; done = false; bad = 0; clearInterval(timer); sel = 'af'; segC.set('af'); msg.className = 'gm-msg'; msg.textContent = 'Drag each continent to its place, or choose one below and tap where it goes.'; report(); cv.redraw();
    }
    const segC = seg(group(panel, 'Place by tapping'), { options: Object.entries(CONTINENTS), value: sel, onChange: (v) => { sel = v; cv.redraw(); } });
    panel.appendChild(msg);
    button(row(panel, 'lab-row-btns'), 'Mix them up', () => pieces && mix(), 'main');
    const st = stats(panel);
    function report() { const n = pieces ? Object.values(pieces).filter((p) => p.placed).length : 0; st.set([['Placed', `${n} of 6`], ['Time', t0 ? fmtTime(done ? endSecs : (Date.now() - t0) / 1000) : '0:00'], ['Wrong taps', String(bad)]]); }
    Promise.all([loadWorld(), fetch(new URL('./atlas/countries.json', import.meta.url)).then((r) => r.json())]).then(([world, list]) => {
      const by = new Map(list.map((c) => [c.n3, c]));
      pieces = Object.fromEntries(Object.keys(CONTINENTS).map((k) => [k, { polys: [], dx: 0, dy: 0, placed: false }]));
      world.forEach((c) => { const k = c.id ? contOf(by.get(c.id) || {}) : NO_ID[c.name]; if (k && pieces[k]) pieces[k].polys.push(...c.polys); });
      mix();
    }).catch(() => { msg.className = 'gm-msg bad'; msg.textContent = 'The map couldn’t load. Check the connection and open the game again.'; });
    report();
    return { state: () => (pieces ? `a world jigsaw with ${Object.values(pieces).filter((p) => p.placed).length} of 6 continents placed${done ? ', finished' : ''}` : 'a world jigsaw, loading'), destroy: () => { clearInterval(timer); cv.destroy(); } };
  },
};

/* ---------------- Landform match ---------------- */
const SKY = '#203a5c', LAND = '#7a9a52', ROCK = '#8a7660', WATER = '#3f7fd1', SNOW = '#f2f2f4';
export const LANDFORMS = [
  ['mountain', 'Mountain', 'Very high land that rises steeply to a peak.', `<rect width="96" height="64" fill="${SKY}"/><path d="M0 64L30 14 46 36 62 8 96 64z" fill="${ROCK}"/><path d="M62 8l-8 13 8-3 6 4z M30 14l-6 10 6-2 5 3z" fill="${SNOW}"/>`],
  ['volcano', 'Volcano', 'A mountain with an opening where hot melted rock (lava), ash and gas come out.', `<rect width="96" height="64" fill="${SKY}"/><path d="M8 64L40 18h16l32 46z" fill="${ROCK}"/><path d="M40 18h16l-4 10-4-6-4 6z" fill="#ff6a3c"/><circle cx="44" cy="10" r="5" fill="#9aa0a8"/><circle cx="52" cy="6" r="4" fill="#9aa0a8"/>`],
  ['valley', 'Valley', 'Low land between hills or mountains, often with a river running through it.', `<rect width="96" height="64" fill="${SKY}"/><path d="M0 16L44 58h8L96 16v48H0z" fill="${LAND}"/><path d="M44 58h8l-2 6h-4z" fill="${WATER}"/>`],
  ['plateau', 'Plateau', 'High, flat land with steep sides.', `<rect width="96" height="64" fill="${SKY}"/><path d="M0 64v-6h18l8-34h44l8 34h18v6z" fill="${ROCK}"/><path d="M26 24h44" stroke="${LAND}" stroke-width="3"/>`],
  ['plain', 'Plain', 'A wide area of flat, low land.', `<rect width="96" height="64" fill="${SKY}"/><rect y="44" width="96" height="20" fill="${LAND}"/><path d="M6 44v-4M16 44v-3M30 44v-4M48 44v-3M66 44v-4M82 44v-3" stroke="#b8d68a" stroke-width="2"/>`],
  ['island', 'Island', 'Land with water all around it.', `<rect width="96" height="64" fill="${WATER}"/><ellipse cx="48" cy="34" rx="22" ry="14" fill="${LAND}"/><path d="M48 30v-10" stroke="#5a3d22" stroke-width="2"/><path d="M48 20c-6 0-8 4-8 4M48 20c6 0 8 4 8 4" stroke="#4caf50" stroke-width="3" fill="none"/>`],
  ['peninsula', 'Peninsula', 'Land with water on three sides, joined to the mainland.', `<rect width="96" height="64" fill="${WATER}"/><path d="M0 0h96v18H60c-6 0-8 4-8 10v20c0 8-4 12-8 12s-8-4-8-12V28c0-6-2-10-8-10H0z" fill="${LAND}"/>`],
  ['bay', 'Bay', 'Part of the sea that curves into the land.', `<rect width="96" height="64" fill="${LAND}"/><path d="M0 64V40c20 0 24-24 48-24s28 24 48 24v24z" fill="${WATER}"/>`],
  ['delta', 'Delta', 'Flat land where a river splits into many channels as it reaches the sea.', `<rect width="96" height="64" fill="${LAND}"/><rect y="50" width="96" height="14" fill="${WATER}"/><path d="M48 0v24M48 24L30 50M48 24L42 50M48 24L56 50M48 24L68 50" stroke="${WATER}" stroke-width="3" fill="none"/>`],
  ['canyon', 'Canyon', 'A deep, narrow valley with steep rock walls, cut by a river.', `<rect width="96" height="64" fill="${SKY}"/><path d="M0 14h36l4 12-2 14 4 24H0z M96 14H60l-2 14 4 12-4 24h38z" fill="#b5653f"/><path d="M42 64l2-8h8l2 8z" fill="${WATER}"/>`],
];
const landformsLab = {
  id: 'landforms', name: 'Landform match', subject: 'games', levels: ['elem', 'hs'],
  blurb: 'Match pictures of mountains, valleys, deltas and more to their names.',
  words: 'landforms mountain volcano valley plateau plain island peninsula bay delta canyon geography matching game',
  icon: '<path d="M4 40l12-20 8 10 8-16 12 26z"/><path d="M4 40h40"/>',
  tries: ['Match one landform', 'Match every landform in a round', 'Finish a round with no mistakes'],
  about: 'Tap a picture, then tap the name it shows (or drag it onto the name). Each round has six of these ten landforms: mountain, volcano, valley, plateau, plain, island, peninsula, bay, delta and canyon.\nA landform is a natural shape of the Earth’s surface, made over a long time by moving plates, volcanoes, rivers, ice, wind and the sea. The pictures are simple drawings, some from the side and some from above.',
  mount({ stage, panel, api }) {
    let wrong = 0, total = 0;
    const msg = el('p', 'gm-msg', 'Tap a picture, then tap its name.'); msg.setAttribute('aria-live', 'polite');
    const st = stats(panel);
    panel.appendChild(msg);
    button(row(panel, 'lab-row-btns'), 'New landforms', () => deal(), 'main');
    function deal() {
      wrong = 0;
      const set = shuffle(LANDFORMS, rand).slice(0, 6);
      matchBoard(stage, {
        items: shuffle(set, rand).map(([id, name, def, svg], i) => ({ id, html: `<svg viewBox="0 0 96 64" aria-hidden="true">${svg}</svg>`, label: `Picture ${i + 1}`, to: id, why: `${name}: ${def}` })),
        places: shuffle(set, rand).map(([id, name]) => ({ id, html: `<span class="mt-name">${esc(name)}</span>`, label: name })),
        cls: 'mt-pics',
        onRight: (it) => { total++; msg.className = 'gm-msg good'; msg.textContent = `Right! ${it.why}`; api.check(0); report(); },
        onWrong: (it, p) => { wrong++; const d = LANDFORMS.find((x) => x[0] === p.id); msg.className = 'gm-msg bad'; msg.textContent = `Not quite. A ${p.label.toLowerCase()} is ${d[2].charAt(0).toLowerCase() + d[2].slice(1)}`; report(); },
        onDone: () => { api.check(1); if (!wrong) api.check(2); const b = api.best(6 - wrong, `${6 - wrong} of 6 first time`); msg.className = 'gm-msg good'; msg.textContent = `All six matched${wrong ? ` with ${wrong} ${wrong === 1 ? 'mistake' : 'mistakes'}` : ', no mistakes'}!${b && b.isNew ? ' A new best!' : ''}`; report(); },
      });
      msg.className = 'gm-msg'; msg.textContent = 'Tap a picture, then tap its name.'; report();
    }
    function report() { st.set([['Matched', String(total)], ['Mistakes this round', String(wrong)]]); }
    deal();
    return { state: () => `matching landform pictures to names: ${total} matched, ${wrong} mistakes this round` };
  },
};

/* ---------------- History in order ---------------- */
export const EVENT_SETS = {
  ph: ['Philippine history', [
    [1521, '1521', 'Lapulapu defeats Magellan’s men at the Battle of Mactan'],
    [1565, '1565', 'Legazpi starts the first Spanish settlement, in Cebu'],
    [1571, '1571', 'Manila becomes the capital of the Spanish Philippines'],
    [1872, '1872', 'The priests Gomburza are executed'],
    [1896, '1896', 'José Rizal is executed in Manila'],
    [1898, '1898', 'Independence is declared in Kawit, Cavite'],
    [1935, '1935', 'The Commonwealth of the Philippines begins'],
    [1946, '1946', 'The United States recognises Philippine independence'],
    [1986, '1986', 'The EDSA People Power Revolution'],
  ]],
  world: ['World history', [
    [-2560, 'about 2560 BC', 'The Great Pyramid of Giza is built'],
    [-776, '776 BC', 'The first recorded Olympic Games, in Greece'],
    [1440, 'about 1440', 'Gutenberg builds his printing press'],
    [1492, '1492', 'Columbus reaches the Americas'],
    [1789, '1789', 'The French Revolution begins'],
    [1914, '1914', 'World War I begins'],
    [1969, '1969', 'People walk on the Moon for the first time'],
    [1989, '1989', 'The Berlin Wall falls'],
  ]],
  science: ['Science and inventions', [
    [1543, '1543', 'Copernicus publishes that the Earth goes round the Sun'],
    [1687, '1687', 'Newton publishes his laws of motion and gravity'],
    [1859, '1859', 'Darwin publishes On the Origin of Species'],
    [1876, '1876', 'Bell patents the telephone'],
    [1903, '1903', 'The Wright brothers make the first powered aeroplane flight'],
    [1928, '1928', 'Fleming discovers penicillin'],
    [1953, '1953', 'The double helix shape of DNA is described'],
    [1991, '1991', 'The World Wide Web opens to the public'],
  ]],
};
const sequencerLab = {
  id: 'sequencer', name: 'History in order', subject: 'games', levels: ['elem', 'hs'],
  blurb: 'Six events, all mixed up. Put them in the order they happened, from earliest to latest.',
  words: 'history timeline chronology sequence events order dates philippine history world history inventions game',
  icon: '<path d="M8 10h20M8 22h28M8 34h14"/><path d="M40 8v30M36 34l4 4 4-4"/>',
  tries: ['Put a set in order', 'Get a whole set right the first time', 'Finish all three sets'],
  about: 'Move the events up and down until the earliest is at the top, then press Check. Events in the right place turn green; the others stay for another try. Each round takes six events from one set: Philippine history, World history, or Science and inventions.\nYears before the birth of Jesus are counted backwards and marked BC (2560 BC is earlier than 776 BC). Some dates are approximate, like the building of the Great Pyramid.',
  mount({ stage, panel, api }) {
    let set = 'ph', list = [], tries = 0, finished = new Set(), checked = new Set();
    const board = el('div', 'mt-board sq-board'); stage.appendChild(board);
    const ol = el('ol', 'sq-list'); board.appendChild(ol);
    const msg = el('p', 'gm-msg', 'Earliest at the top.'); msg.setAttribute('aria-live', 'polite');
    seg(group(panel, 'Events from'), { options: Object.entries(EVENT_SETS).map(([k, [n]]) => [k, n]), value: set, onChange: (v) => { set = v; deal(); } });
    const r = row(panel, 'lab-row-btns');
    button(r, 'Check', () => check(), 'main'); button(r, 'New events', () => deal());
    panel.appendChild(msg);
    const st = stats(panel);
    function deal() { list = shuffle(shuffle(EVENT_SETS[set][1], rand).slice(0, 6), rand); while (list.every((e, i) => i === 0 || list[i - 1][0] < e[0])) list = shuffle(list, rand); tries = 0; checked = new Set(); msg.className = 'gm-msg'; msg.textContent = 'Earliest at the top. Move them with the arrows, then press Check.'; draw(); report(); }
    function draw() {
      ol.replaceChildren();
      list.forEach((e, i) => {
        const li = el('li', 'sq-ev' + (checked.has(e[2]) ? ' sq-ok' : ''));
        li.dataset.year = String(e[0]);
        li.innerHTML = `<span class="sq-text">${esc(e[2])}${checked.has(e[2]) ? ` <b class="sq-year">${esc(e[1])}</b>` : ''}</span>`;
        const up = el('button', 'sq-mv', '↑'), dn = el('button', 'sq-mv', '↓'); up.type = dn.type = 'button';
        up.setAttribute('aria-label', `Move up: ${e[2]}`); dn.setAttribute('aria-label', `Move down: ${e[2]}`); up.disabled = i === 0; dn.disabled = i === list.length - 1;
        up.addEventListener('click', () => move(i, -1)); dn.addEventListener('click', () => move(i, 1));
        li.append(up, dn); ol.appendChild(li);
      });
    }
    function move(i, d) { const j = i + d; [list[i], list[j]] = [list[j], list[i]]; draw(); const b = ol.children[j] && ol.children[j].querySelector(d < 0 ? '.sq-mv' : '.sq-mv:last-of-type'); if (b && !b.disabled) b.focus(); }
    function check() {
      tries++;
      const sorted = list.slice().sort((a, b) => a[0] - b[0]);
      checked = new Set(list.filter((e, i) => sorted[i] === e).map((e) => e[2]));
      if (checked.size === list.length) {
        api.check(0); if (tries === 1) api.check(1); finished.add(set); if (finished.size === 3) api.check(2);
        const b = api.best(-tries, `in order in ${tries} ${tries === 1 ? 'try' : 'tries'}`, false);
        msg.className = 'gm-msg good'; msg.textContent = `All in order${tries === 1 ? ' on the first try' : ` in ${tries} tries`}!${b && b.isNew ? ' A new best!' : ''} The years are shown.`;
      } else { msg.className = 'gm-msg bad'; msg.textContent = `${checked.size} of 6 in the right place (green). Move the others and check again.`; }
      draw(); report();
    }
    function report() { st.set([['Set', EVENT_SETS[set][0]], ['Checks this round', String(tries)], ['Sets finished', `${finished.size} of 3`]]); }
    deal();
    return { state: () => `putting ${EVENT_SETS[set][0].toLowerCase()} events in order: ${list.map((e) => e[2]).join('; ')}` };
  },
};

/* ---------------- Shape sorter (for little ones) ---------------- */
const SHAPE_SVG = {
  circle: '<circle cx="24" cy="24" r="17"/>', square: '<rect x="8" y="8" width="32" height="32" rx="2"/>', triangle: '<path d="M24 6l19 34H5z"/>',
  star: '<path d="M24 5l5.8 12 13.2 1.8-9.6 9.1 2.4 13.1L24 34.8 12.2 41l2.4-13.1L5 18.8l13.2-1.8z"/>', heart: '<path d="M24 41C10 31 5 24 5 16.5 5 10.7 9.4 7 14.5 7c4 0 7.4 2.3 9.5 6 2.1-3.7 5.5-6 9.5-6C38.6 7 43 10.7 43 16.5 43 24 38 31 24 41z"/>',
  rectangle: '<rect x="4" y="14" width="40" height="20" rx="2"/>', diamond: '<path d="M24 4l18 20-18 20L6 24z"/>', oval: '<ellipse cx="24" cy="24" rx="20" ry="13"/>',
};
const SHAPE_COL = ['#e5484d', '#2f6fd6', '#f2c200', '#2e9e5b', '#e8862a', '#8e4ec6'];
const sorterLab = {
  id: 'sorter', name: 'Shape sorter', subject: 'games', levels: ['pre', 'elem'],
  blurb: 'Put each shape in its matching hole: circle, square, triangle, star, heart and more.',
  words: 'shapes shape sorter circle square triangle star heart rectangle diamond oval little ones nursery kindergarten matching game',
  icon: '<rect x="4" y="22" width="40" height="20" rx="3"/><circle cx="14" cy="32" r="5"/><path d="M28 36l5-9 5 9z"/><path d="M24 4v12M20 12l4 4 4-4"/>',
  tries: ['Put a shape in its hole', 'Fill every hole'],
  about: 'Tap a shape, then tap the hole that fits it (or drag it there). Cassie says each shape’s name. A wrong hole is fine: try another!',
  mount({ stage, panel, api }) {
    let n = 4, placed = 0;
    stage.classList.add('kid-stage');
    const msg = el('p', 'gm-msg', 'Tap a shape, then its hole.'); msg.setAttribute('aria-live', 'polite');
    seg(group(panel, 'How many shapes'), { options: [[4, '4'], [6, '6'], [8, '8']], value: n, onChange: (v) => { n = v; deal(); } });
    panel.appendChild(msg);
    button(row(panel, 'lab-row-btns'), 'New shapes', () => deal(), 'main');
    function deal() {
      placed = 0;
      const names = shuffle(Object.keys(SHAPE_SVG), rand).slice(0, n), cols = shuffle(SHAPE_COL, rand);
      const svg = (k, fill) => `<svg viewBox="0 0 48 48" aria-hidden="true" ${fill ? `fill="${fill}" stroke="#1b1b1d" stroke-width="1.5"` : 'fill="rgba(0,0,0,.45)" stroke="rgba(255,255,255,.55)" stroke-width="2" stroke-dasharray="4 3"'}>${SHAPE_SVG[k]}</svg>`;
      matchBoard(stage, {
        items: names.map((k, i) => ({ id: k, html: svg(k, cols[i % cols.length]), label: k, to: k })),
        places: shuffle(names, rand).map((k) => ({ id: k, html: svg(k), label: `${k} hole` })),
        cls: 'mt-kids mt-shapes',
        onRight: (it) => { placed++; api.check(0); msg.className = 'gm-msg good'; msg.textContent = `Yes! The ${it.label}!`; say(`Yes! The ${it.label}!`); },
        onWrong: (it) => { msg.className = 'gm-msg bad'; msg.textContent = `The ${it.label} doesn’t fit there. Try another hole!`; say(`Try another hole!`); },
        onDone: () => { api.check(1); msg.className = 'gm-msg good'; msg.textContent = 'Every shape is in! Great job!'; say('Every shape is in! Great job!'); },
      });
      msg.className = 'gm-msg'; msg.textContent = 'Tap a shape, then its hole.';
    }
    deal();
    return { state: () => `sorting ${n} shapes into their holes, ${placed} in`, destroy: () => { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* */ } } };
  },
};

/* ---------------- History dress-up ---------------- */
// photos: public domain or CC0, from Wikimedia Commons (credits in CREDITS.md and on each card)
export const OUTFITS = [
  ['ilocana', 'Ilocos, Philippines, 1820s', 'An Ilocana woman in a bádo (blouse) and pandiling (wrap skirt), painted by Damián Domingo, called the father of Philippine painting, for his series Tipos del País.', 'Damián Domingo, about 1820s. Public domain'],
  ['moro', 'Mindanao and Sulu, Philippines, 1700s to 1800s', 'A Moro warrior’s helmet. Moro armour was made of brass plates, mail and sometimes carabao horn, worn in battles against Spanish forces.', 'The Metropolitan Museum of Art, CC0'],
  ['gusoku', 'Japan, 1700s (Edo period)', 'Samurai armour (gusoku): small lacquered plates laced together with silk cords, light enough to move and fight in.', 'The Metropolitan Museum of Art, CC0'],
  ['corinthian', 'Ancient Greece, early 500s BC', 'A bronze Corinthian helmet, beaten from one sheet of bronze. Greek foot soldiers (hoplites) wore it with a round shield.', 'The Metropolitan Museum of Art, CC0'],
  ['collar', 'Ancient Egypt, about 1850 to 1775 BC', 'The broad collar of Senebtisi: rows of faience beads strung into a wide necklace, worn by Egyptian women and men.', 'The Metropolitan Museum of Art, CC0'],
  ['clifford', 'England, 1586 (Tudor times)', 'Steel plate armour made for George Clifford, Earl of Cumberland, at Queen Elizabeth I’s royal workshop in Greenwich, etched and gilded.', 'The Metropolitan Museum of Art, CC0'],
];
export const outfitPic = (id, small) => new URL(`./dressup/${id}${small ? '-s' : ''}.webp`, import.meta.url).href;
const dressupLab = {
  id: 'dressup', name: 'History dress-up', subject: 'games', levels: ['elem', 'hs'],
  blurb: 'Real clothes, armour and jewellery from museums. Guess where and when each was worn.',
  words: 'history clothing costume armour armor dress up artifacts museum samurai greek egypt tudor philippines moro baro ilocana culture era game',
  icon: '<path d="M16 6l-8 6 4 8 4-2v22h16V18l4 2 4-8-8-6c-2 3-5 4-8 4s-6-1-8-4z"/>',
  tries: ['Match one piece to its time and place', 'Go through every piece', 'Get every piece right in one game'],
  about: 'Each card is a real piece from a museum or a painting of its time. Choose where and when it was worn; after you choose, Cassie tells you about it.\nThe photos are public domain or CC0 (free for anyone to use) from Wikimedia Commons, most from The Metropolitan Museum of Art’s open collection; each card names its source. Dates are as the museum gives them.',
  mount({ stage, panel, api }) {
    let order = [], at = 0, right = 0, answered = false, slips = 0, missed = false; // (right: on the first guess)
    const card = el('div', 'mt-board du-board'); stage.appendChild(card);
    const msg = el('p', 'gm-msg'); msg.setAttribute('aria-live', 'polite');
    const opts = el('div', 'du-opts'); opts.setAttribute('role', 'group'); opts.setAttribute('aria-label', 'Where and when');
    panel.appendChild(opts); panel.appendChild(msg);
    const r = row(panel, 'lab-row-btns');
    const nextB = button(r, 'Next', () => { at++; show(); }, 'main');
    button(r, 'Start again', () => start());
    const st = stats(panel);
    function start() { order = shuffle(OUTFITS, rand); at = 0; right = 0; slips = 0; show(); }
    function show() {
      answered = false; missed = false; nextB.hidden = true; msg.className = 'gm-msg'; msg.textContent = '';
      if (at >= order.length) {
        api.check(1); if (right === order.length) api.check(2);
        const b = api.best(right, `${right} of ${order.length} right`);
        card.innerHTML = `<div class="du-end"><b>${right} of ${order.length} right!</b><p>${right === order.length ? 'Every one! You know your history.' : 'Press Start again to try for all of them.'}${b && b.isNew ? ' A new best!' : ''}</p></div>`;
        opts.replaceChildren(); report(); return;
      }
      const o = order[at];
      card.innerHTML = `<figure class="du-fig"><img src="${outfitPic(o[0])}" alt="A museum piece to guess (${at + 1} of ${order.length})" draggable="false"><figcaption>${esc(o[3])}, via Wikimedia Commons</figcaption></figure>`;
      card.querySelector('img').addEventListener('error', (e) => { e.target.replaceWith(el('p', 'du-end', 'This picture couldn’t load. You can still guess from the choices, or press Next.')); nextB.hidden = false; });
      const choices = shuffle([o, ...shuffle(OUTFITS.filter((x) => x !== o), rand).slice(0, 3)], rand);
      opts.replaceChildren();
      choices.forEach((c) => { const b = button(opts, c[1], () => choose(c, b), 'du-opt'); b.dataset.id = c[0]; });
      report();
    }
    function choose(c, b) {
      if (answered) return;
      const o = order[at];
      if (c === o) {
        answered = true; if (!missed) right++; b.classList.add('du-yes'); api.check(0);
        msg.className = 'gm-msg good'; msg.textContent = `${missed ? 'Got it' : 'Yes'}: ${o[1]}. ${o[2]}`;
        opts.querySelectorAll('button').forEach((x) => { x.disabled = x !== b; }); nextB.hidden = false;
        card.querySelector('img').alt = o[2];
      } else {
        slips++; missed = true; b.classList.add('du-no'); b.disabled = true;
        msg.className = 'gm-msg bad'; msg.textContent = `Not ${c[1].split(',')[0]}. Look at the materials and the style. Try again!`;
      }
      report();
    }
    function report() { st.set([['Piece', `${Math.min(at + 1, order.length)} of ${order.length}`], ['Right first time', String(right)], ['Wrong guesses', String(slips)]]); }
    start();
    return { state: () => (at < order.length ? `guessing where and when piece ${at + 1} of ${order.length} was worn; ${right} right so far` : `finished: ${right} of ${order.length} right`) };
  },
};

export const GAMES2 = [habitatsLab, jigsawLab, landformsLab, sequencerLab, sorterLab, dressupLab];

/* World atlas: tap any country on the map (or search it) for its flag, capital, population, size,
   languages, money and neighbours, and a short history from Wikipedia. Search any place —
   a city, a mountain, a landmark — and Cassie finds it on Wikipedia and pins it on the map.
   Country facts: the world-countries data (ODbL) and World Bank population figures (CC BY 4.0),
   kept with the app so they work offline; the newest population and the history come live from
   the World Bank and Wikipedia when you're online. Flags: flag-icons (MIT). */
import { el, esc, num, canvas, drag, at, group, button, row, overlay, text, dot, line, C, INK, DIM } from './kit.js';
import { loadWorld, naturalEarth, FULL_NAMES } from './puzzles.js';

let dataP = null;
const loadData = () => (dataP || (dataP = fetch(new URL('./atlas/countries.json', import.meta.url)).then((r) => r.json()).catch((e) => { dataP = null; throw e; })));
const flagUrl = (c) => new URL(`./atlas/flags/${c.c2.toLowerCase()}.svg`, import.meta.url).href;
const WIKI = 'https://en.wikipedia.org';
const cache = new Map();
async function getJson(url, ms = 8000) {
  if (cache.has(url)) return cache.get(url);
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json(); cache.set(url, j); return j;
}
// a short summary of a Wikipedia article: { title, text, url, image, at: [lat, lon] }
async function wikiSummary(title) {
  const j = await getJson(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  if (!j || j.type === 'disambiguation' || !j.extract) return null;
  return { title: j.title, text: j.extract, url: j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page, image: j.thumbnail && j.thumbnail.source, at: j.coordinates ? [j.coordinates.lat, j.coordinates.lon] : null, kind: j.description || '' };
}
async function wikiSearch(q) {
  const j = await getJson(`${WIKI}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=6&format=json&origin=*`);
  return ((j.query && j.query.search) || []).map((r) => r.title);
}
// the latest population the World Bank has (one figure, with its year)
async function latestPopulation(c3) {
  const j = await getJson(`https://api.worldbank.org/v2/country/${c3}/indicator/SP.POP.TOTL?format=json&mrnev=1`, 6000);
  const row = Array.isArray(j) && j[1] && j[1][0];
  return row && row.value ? [row.value, +row.date] : null;
}
const safeUrl = (u) => (/^https:\/\/[a-z]+\.wikipedia\.org\//.test(u || '') ? u : null);
const safeImg = (u) => (/^https:\/\/upload\.wikimedia\.org\//.test(u || '') ? u : null);

export const atlasLab = {
  id: 'atlas', name: 'World atlas', subject: 'geography', topic: 'world geography: countries, capitals, populations, languages and their history',
  blurb: 'Tap any country for its flag, capital, population, languages and a short history — or search any place in the world.',
  words: 'atlas world map countries flags capitals population geography history places cities search',
  icon: '<circle cx="24" cy="24" r="18"/><path d="M6 24h36M24 6c-7 6-7 30 0 36M24 6c7 6 7 30 0 36"/><path d="M14 12l4 4-2 5 4 3M32 30l3 4"/>',
  tries: ['Look up a country’s flag, capital and population', 'Find a country with more than 200 million people', 'Search a place that isn’t a country (a city, a volcano…)'],
  hints: ['Tap any country on the map — your own, maybe — or type its name in the search box.', 'Try the biggest countries in Asia, the Americas or Africa — there are only a few above 200 million.', 'Type a city, a mountain or a landmark in the search box, then tap “Search places”.'],
  about: 'Country facts come from the open world-countries data (ODbL) and populations from the World Bank (CC BY 4.0), stored with Cassie so they work offline; when you’re online Cassie also asks the World Bank for its newest figure, and the year is always shown. Populations are estimates.\nThe history and place summaries come from Wikipedia (CC BY-SA) and are shown with a link to the full article. Map: Natural Earth (public domain). Borders are shown as drawn in that data and are not a statement about any disputed territory.',
  mount({ stage, panel, api }) {
    let data = [], world = null, sel = null, place = null, vk = 1, vx = 0, vy = 0, proj = null;
    const byN3 = new Map(), byC3 = new Map();
    // search
    const sg = group(panel, 'Search');
    const form = el('form', 'atlas-search');
    form.innerHTML = '<input type="search" placeholder="A country or any place: Japan, Paris, Mount Apo…" aria-label="Search a country or a place" autocomplete="off"><button type="submit" class="lab-btn main">Search</button>';
    sg.appendChild(form);
    const input = form.querySelector('input'), sugg = el('div', 'atlas-sugg'); sg.appendChild(sugg);
    const card = el('div', 'atlas-card'); panel.appendChild(card);
    card.innerHTML = '<p class="lab-note">Tap a country on the map, or search for one. Drag to move the map; pinch or scroll to zoom.</p>';

    function suggest() {
      const q = input.value.trim().toLowerCase();
      if (!q || !data.length) { sugg.replaceChildren(); return; }
      const hits = data.filter((c) => c.n.toLowerCase().includes(q) || c.o.toLowerCase().includes(q) || (c.cap || []).some((x) => x.toLowerCase().includes(q))).slice(0, 6);
      sugg.innerHTML = hits.map((c) => `<button type="button" data-c3="${esc(c.c3)}">${c.f ? `<img src="${flagUrl(c)}" alt="">` : ''}${esc(c.n)}${(c.cap || []).length ? ` <small>· ${esc(c.cap[0])}</small>` : ''}</button>`).join('')
        + `<button type="button" data-place="${esc(input.value.trim())}" class="atlas-place-btn">🔎 Search places: “${esc(input.value.trim())}”</button>`;
    }
    input.addEventListener('input', suggest);
    sugg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c3]'); if (b) { choose(byC3.get(b.dataset.c3)); sugg.replaceChildren(); return; }
      const p = e.target.closest('[data-place]'); if (p) { findPlace(p.dataset.place); sugg.replaceChildren(); }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim().toLowerCase(); if (!q) return;
      const exact = data.find((c) => c.n.toLowerCase() === q || c.o.toLowerCase() === q || c.c3.toLowerCase() === q);
      sugg.replaceChildren();
      if (exact) choose(exact); else findPlace(input.value.trim());
    });

    /* ---------- a country ---------- */
    const fmtPop = (p) => (p >= 1e9 ? `${num(p / 1e9, 3)} billion` : p >= 1e6 ? `${num(p / 1e6, 3)} million` : Math.round(p).toLocaleString());
    async function choose(c, fromMap) {
      if (!c) return;
      sel = c; place = null;
      if (!fromMap) zoomTo(c);
      cv.redraw();
      const fact = (k, v) => (v ? `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>` : '');
      const neighbours = (c.bor || []).map((b) => byC3.get(b)).filter(Boolean);
      card.innerHTML = `<div class="atlas-head">${c.f ? `<img class="atlas-flag" src="${flagUrl(c)}" alt="Flag of ${esc(c.n)}">` : ''}<div><h3>${esc(c.n)}</h3><p class="space-sub">${esc(c.o)}</p></div></div>
        <dl class="lab-stats">
          ${fact('Capital', esc((c.cap || []).join(', ') || '—'))}
          ${fact('Population', c.pop ? `<span class="atlas-pop">${fmtPop(c.pop[0])} <small>(${c.pop[1]}, World Bank)</small></span>` : 'not in the World Bank data')}
          ${fact('Area', c.area ? `${Math.round(c.area).toLocaleString()} km²` : '')}
          ${fact('Where', esc([c.sub || c.reg, c.land ? 'landlocked (no coast)' : ''].filter(Boolean).join(' · ')))}
          ${fact('Languages', esc((c.lang || []).join(', ')))}
          ${fact('Money', esc((c.cur || []).join(', ')))}
          ${fact('People are called', esc(c.dem))}
          ${fact('Calling code · web', esc([c.call, (c.tld || [])[0]].filter(Boolean).join(' · ')))}
          ${fact('UN member', c.un ? 'yes' : c.ind ? 'no' : 'no — a territory')}
        </dl>
        ${neighbours.length ? `<h4 class="atlas-h4">Neighbours</h4><div class="atlas-chips">${neighbours.map((n) => `<button type="button" data-c3="${esc(n.c3)}">${n.f ? `<img src="${flagUrl(n)}" alt="">` : ''}${esc(n.n)}</button>`).join('')}</div>` : ''}
        <h4 class="atlas-h4">History</h4><div class="atlas-wiki"><p class="lab-note">Looking it up on Wikipedia…</p></div>`;
      api.check(0);
      if (c.pop && c.pop[0] > 2e8) api.check(1);
      // the newest population, and the history (both need the internet)
      latestPopulation(c.c3).then((p) => { if (sel !== c || !p || (c.pop && p[1] <= c.pop[1])) return; const e = card.querySelector('.atlas-pop'); if (e) e.innerHTML = `${fmtPop(p[0])} <small>(${p[1]}, World Bank)</small>`; if (p[0] > 2e8) api.check(1); }).catch(() => {});
      const box = card.querySelector('.atlas-wiki');
      let w = null;
      try { w = (await wikiSummary(`History of ${c.n}`)) || (await wikiSummary(c.n)); } catch (e) { w = null; }
      if (sel !== c) return;
      box.innerHTML = w ? `<p>${esc(w.text)}</p>${safeUrl(w.url) ? `<a href="${esc(safeUrl(w.url))}" target="_blank" rel="noopener noreferrer">Read more on Wikipedia ↗</a>` : ''}` : '<p class="lab-note">The history couldn’t be loaded (no internet?). Tap Ask Cassie to hear about it.</p>';
    }
    card.addEventListener('click', (e) => { const b = e.target.closest('[data-c3]'); if (b) choose(byC3.get(b.dataset.c3)); });

    /* ---------- any place, from Wikipedia ---------- */
    async function findPlace(q) {
      sel = null; place = null; cv.redraw();
      card.innerHTML = `<p class="lab-note">Searching Wikipedia for “${esc(q)}”…</p>`;
      let titles = [];
      try { titles = await wikiSearch(q); } catch (e) { card.innerHTML = '<p class="lab-err">Searching places needs the internet. Countries work offline — try a country name.</p>'; return; }
      if (!titles.length) { card.innerHTML = `<p class="lab-note">Nothing found for “${esc(q)}”. Check the spelling, or try a bigger place nearby.</p>`; return; }
      card.innerHTML = `<h4 class="atlas-h4">Places called “${esc(q)}”</h4><div class="atlas-results">${titles.map((t) => `<button type="button" data-title="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
      if (titles.length === 1) showPlace(titles[0]);
    }
    async function showPlace(title) {
      card.innerHTML = `<p class="lab-note">Opening “${esc(title)}”…</p>`;
      let w = null;
      try { w = await wikiSummary(title); } catch (e) { w = null; }
      if (!w) { card.innerHTML = '<p class="lab-err">That page couldn’t be loaded — try another result.</p>'; return; }
      place = w.at ? { name: w.title, at: w.at } : null; sel = null;
      if (place) { const inC = world && countryAt(w.at[1], w.at[0]); zoomToPoint(w.at, inC ? 4 : 3); }
      cv.redraw();
      const img = safeImg(w.image);
      card.innerHTML = `${img ? `<img class="atlas-photo" src="${esc(img)}" alt="${esc(w.title)}">` : ''}<h3>${esc(w.title)}</h3>${w.kind ? `<p class="space-sub">${esc(w.kind)}</p>` : ''}<p>${esc(w.text)}</p>
        ${w.at ? `<p class="lab-note">📍 ${num(Math.abs(w.at[0]), 4)}° ${w.at[0] >= 0 ? 'N' : 'S'}, ${num(Math.abs(w.at[1]), 4)}° ${w.at[1] >= 0 ? 'E' : 'W'} — pinned on the map</p>` : '<p class="lab-note">Wikipedia has no single location for this, so it isn’t pinned.</p>'}
        ${safeUrl(w.url) ? `<a href="${esc(safeUrl(w.url))}" target="_blank" rel="noopener noreferrer">Read more on Wikipedia ↗</a>` : ''}`;
      const inside = w.at && world && countryAt(w.at[1], w.at[0]), c = inside && byN3.get(String(inside.id));
      if (c) { const b = el('button', 'lab-btn', `About ${c.n} ›`); b.type = 'button'; b.addEventListener('click', () => choose(c)); card.appendChild(b); }
      if (w.at) api.check(2);
    }
    card.addEventListener('click', (e) => { const b = e.target.closest('[data-title]'); if (b) showPlace(b.dataset.title); });

    /* ---------- the map ---------- */
    function countryAt(lon, lat) {
      const inside = (rg, x, y) => { let inn = false, prev = null; const pts = rg.map(([lo, la]) => { if (prev != null) { while (lo - prev > 180) lo -= 360; while (prev - lo > 180) lo += 360; } prev = lo; return [lo, la]; }); for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inn = !inn; } return inn; };
      for (const c of world) for (const poly of c.polys) for (const lo of [lon, lon - 360, lon + 360]) if (inside(poly[0], lo, lat) && !poly.slice(1).some((h) => inside(h, lo, lat))) return c;
      return null;
    }
    const cv = canvas(stage, (ctx, w, h) => {
      if (!world) { text(ctx, 'Loading the map…', w / 2, h / 2, DIM, 'center'); return; }
      const corners = [[-180, -58], [180, 84], [-180, 84], [180, -58], [0, 84], [0, -58]].map(([a, b]) => naturalEarth(a, b));
      const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]), s = Math.min((w - 20) / (Math.max(...xs) - Math.min(...xs)), (h - 20) / (Math.max(...ys) - Math.min(...ys)));
      const cx = w / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * s, cy = h / 2 + ((Math.max(...ys) + Math.min(...ys)) / 2) * s;
      const P0 = (lon, lat) => { const [x, y] = naturalEarth(lon, lat); return [cx + x * s, cy - y * s]; };
      const P = (lon, lat) => { const [x, y] = P0(lon, lat); return [(x - w / 2) * vk + w / 2 + vx, (y - h / 2) * vk + h / 2 + vy]; };
      proj = { P, w, h, inv: (x, y) => {
        x = (x - w / 2 - vx) / vk + w / 2; y = (y - h / 2 - vy) / vk + h / 2;
        let best = null, bd = Infinity; for (let lo = -180; lo <= 180; lo += 1) for (let la = -60; la <= 85; la += 1) { const [px, py] = P0(lo, la), d = (px - x) ** 2 + (py - y) ** 2; if (d < bd) { bd = d; best = [lo, la]; } }
        let [lo, la] = best; for (let st = 0.5; st > 0.01; st /= 2) for (let it = 0; it < 4; it++) for (const [a, b] of [[st, 0], [-st, 0], [0, st], [0, -st]]) { const [px, py] = P0(lo + a, la + b), d = (px - x) ** 2 + (py - y) ** 2; if (d < bd) { bd = d; lo += a; la += b; } }
        return [la, lo]; } };
      ctx.fillStyle = 'rgba(80,120,170,.14)'; ctx.fillRect(0, 0, w, h);
      for (const c of world) {
        const isSel = sel && sel.n3 && +c.id === +sel.n3;
        ctx.beginPath();
        c.polys.forEach((poly) => poly.forEach((rg) => { let prev = null; rg.forEach(([lo, la], i) => { if (prev != null) { while (lo - prev > 180) lo -= 360; while (prev - lo > 180) lo += 360; } prev = lo; const [x, y] = P(lo, la); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); }));
        ctx.fillStyle = isSel ? C.gold : 'rgba(232,228,218,.24)'; ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(16,17,22,.8)'; ctx.lineWidth = 0.6; ctx.stroke();
      }
      // the name of the picked country, and a pin for a place
      if (sel && sel.ll) { const [x, y] = P(sel.ll[1], sel.ll[0]); ctx.font = '700 14px -apple-system, Segoe UI, sans-serif'; text(ctx, sel.n, x, y - 8, '#fff', 'center'); }
      if (place) { const [x, y] = P(place.at[1], place.at[0]); line(ctx, [[x, y], [x, y - 22]], '#fff', 2); dot(ctx, x, y - 26, 7, C.red); dot(ctx, x, y, 3, '#fff'); ctx.font = '700 13px -apple-system, Segoe UI, sans-serif'; text(ctx, place.name, x, y - 38, '#fff', 'center'); }
    });
    function zoomToPoint([lat, lon], k) {
      if (!proj) return;
      vk = 1; vx = 0; vy = 0;
      const [x, y] = proj.P(lon, lat); vk = k; vx = (proj.w / 2 - x) * k; vy = (proj.h / 2 - y) * k;
    }
    function zoomTo(c) {
      if (!c.ll || !proj) return;
      const big = c.area > 3e6 ? 1.6 : c.area > 5e5 ? 2.6 : c.area > 5e4 ? 4 : 7;
      zoomToPoint(c.ll, big);
    }
    function zoomAt(x, y, f) {
      const k2 = Math.min(30, Math.max(1, vk * f)); f = k2 / vk;
      vx = (vx + proj.w / 2 - x) * f - proj.w / 2 + x; vy = (vy + proj.h / 2 - y) * f - proj.h / 2 + y; vk = k2;
      if (vk === 1) { vx = 0; vy = 0; }
      cv.redraw();
    }
    // drag to move, pinch or scroll to zoom, tap a country
    const pts = new Map(); let last = null, moved = false;
    drag(cv.c, {
      down(p, e) { pts.set(e.pointerId, p); last = p; moved = false; },
      move(p, e) {
        const before = pts.get(e.pointerId); pts.set(e.pointerId, p);
        if (pts.size === 2) { const [a, b] = [...pts.values()], prev = [...pts.entries()].map(([id, q]) => (id === e.pointerId ? before : q)); const d0 = Math.hypot(prev[0].x - prev[1].x, prev[0].y - prev[1].y), d1 = Math.hypot(a.x - b.x, a.y - b.y); if (d0 > 0 && proj) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d1 / d0); moved = true; return; }
        if (Math.hypot(p.x - last.x, p.y - last.y) > 6 || moved) { moved = true; vx += p.x - before.x; vy += p.y - before.y; cv.redraw(); }
      },
      up(p, e) {
        pts.delete(e.pointerId);
        if (moved || pts.size || !proj || !world) return;
        const ll = proj.inv(p.x, p.y), c = countryAt(ll[1], ll[0]);
        if (c && byN3.has(String(c.id))) choose(byN3.get(String(c.id)), true);
        else if (c) { sel = null; card.innerHTML = `<h3>${esc(FULL_NAMES[c.name] || c.name)}</h3><p class="lab-note">There is no country page for this area in the data (its status is disputed or it isn’t a separate country there). Tap Ask Cassie to learn about it.</p>`; place = { name: FULL_NAMES[c.name] || c.name, at: ll }; cv.redraw(); }
      },
    });
    cv.c.addEventListener('pointercancel', (e) => pts.delete(e.pointerId));
    cv.c.addEventListener('wheel', (e) => { if (!proj) return; e.preventDefault(); const p = at(cv.c, e); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.25 : 1 / 1.25); }, { passive: false });
    const zb = overlay(stage, 'br');
    button(zb, '+', () => proj && zoomAt(proj.w / 2, proj.h / 2, 1.6)).setAttribute('aria-label', 'Zoom in');
    button(zb, '−', () => proj && zoomAt(proj.w / 2, proj.h / 2, 1 / 1.6)).setAttribute('aria-label', 'Zoom out');
    button(zb, 'Whole world', () => { vk = 1; vx = 0; vy = 0; cv.redraw(); });
    Promise.all([loadData(), loadWorld()]).then(([d, wd]) => {
      data = d; world = wd;
      d.forEach((c) => { byC3.set(c.c3, c); if (c.n3) byN3.set(String(+c.n3), c); });
      // (the map's ids have no leading zeros in a few files; keep both)
      d.forEach((c) => { if (c.n3) byN3.set(c.n3, c); });
      cv.redraw(); suggest();
    }).catch(() => { card.innerHTML = '<p class="lab-err">The atlas couldn’t load — check your internet and open it again.</p>'; });
    return {
      state: () => (sel ? `looking at ${sel.n} in the world atlas: capital ${(sel.cap || []).join(', ')}, population ${sel.pop ? `${fmtPop(sel.pop[0])} (${sel.pop[1]})` : 'unknown'}, ${sel.sub || sel.reg}, languages ${(sel.lang || []).join(', ')}` : place ? `looking at ${place.name} in the world atlas` : 'looking at the world map in the atlas'),
      destroy: () => cv.destroy(),
    };
  },
};

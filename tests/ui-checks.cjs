/* Checks on a screen as it shows, used by the design smoke tests.
     tapTargetIssues(page)      → controls that can't be tapped properly. Each is scrolled into view, then:
                                  · its touch area is smaller than 44 x 44 (points 21px out from its
                                    centre must still land on it)
                                  · it is partly off the screen
                                  · its container cuts part of it off (overflow hidden / scroll)
                                  · something else sits over part of it, or all of it (the tab bar,
                                    a floating bar). A control under a whole-screen sheet or dialog
                                    is not counted: that sheet is what's on screen.
     contrastIssues(page, sel)  → words under WCAG AA against the real pixels behind them (glass over
                                  the marble): the screen is shot once with every word made invisible,
                                  and each word's colour is measured against what was behind it
     tapResponseIssues(page, o) → every control on the screen is tapped for real (a finger on a touch
                                  screen, a mouse on a computer), one at a time, the screen opened
                                  fresh again whenever a tap changed it. Each one fails when:
                                  · something else on top catches the tap
                                  · the phone's 300 ms tap delay is on for it (no touch-action:
                                    manipulation, or a page without width=device-width)
                                  · nothing visibly changes within 100 ms of the finger landing
                                  · the page is blocked by work longer than 100 ms right after
                                  · one tap fires its click twice
                                  · dragging it (a slider, a handle, a card you can move) also
                                    counts as a tap */

async function tapTargetIssues(page) {
  return page.evaluate(() => {
    const out = [];
    const W = innerWidth, H = innerHeight;
    const all = document.querySelectorAll('button, a[href], [role=button], [role=tab], input:not([type=hidden]), select, textarea, summary');
    const name = (e, r) => `${!e.id && !e.classList.length && e.parentElement && e.parentElement.classList.length ? '.' + [...e.parentElement.classList].join('.') + ' > ' : ''}${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.classList.length ? '.' + [...e.classList].join('.') : ''} "${(e.getAttribute('aria-label') || e.textContent || e.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`;
    // a tap on a box's own <label> works the box too (a switch row, a colour swatch)
    const own = (e, x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === e || e.contains(h) || [...(e.labels || [])].some((l) => l.contains(h))); };
    // what covers a control: named by its nearest fixed or sticky box (the tab bar, a top bar…)
    const coverOf = (h) => { for (let n = h; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return n; } return h; };
    const big = (n) => { const r = n.getBoundingClientRect(); return r.width * r.height >= W * H * 0.6; };
    // the layer a box is drawn in: its outermost fixed (or absolute) box, else the page
    const layer = (n) => { let top = null; for (; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'absolute') top = n; } return top || document.body; };
    // a control behind a sheet or dialog that covers most of the screen is not what's on screen
    const behindSheet = (e, h) => {
      const lh = layer(h);
      if (lh !== layer(e) && !lh.contains(e) && (big(lh) || big(coverOf(h)))) return true;
      // or a panel laid over most of this layer (the study room's panel over the board)
      let n = h; while (n.parentElement && !n.parentElement.contains(e)) n = n.parentElement;
      const p = getComputedStyle(n).position;
      return n !== h.ownerDocument.body && (p === 'fixed' || p === 'absolute') && big(n);
    };
    // a panel parked off the screen (a closed side menu) is not on screen either
    const parked = (e) => { for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) { const r = n.getBoundingClientRect(), p = getComputedStyle(n).position; if ((p === 'fixed' || p === 'absolute') && (r.right <= 0 || r.left >= W || r.bottom <= 0 || r.top >= H)) return true; } return false; };
    const label = (n) => `${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}${n.classList.length ? '.' + [...n.classList].slice(0, 2).join('.') : ''}`;
    for (const e of all) {
      if (!e.getClientRects().length) continue;
      const st = getComputedStyle(e);
      if (st.visibility === 'hidden' || +st.opacity === 0 || st.pointerEvents === 'none' || e.closest('[hidden], [inert], [aria-hidden="true"]')) continue;
      if (e.disabled || (e.checkVisibility && !e.checkVisibility({ contentVisibilityAuto: true }))) continue; // (inside a closed <details>, say)
      e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); // (instant: a smooth-scrolling page hasn't moved yet when it's measured)
      // (a control that wraps over several lines, like a sentence: its biggest line is what's tapped)
      const rects = [...e.getClientRects()];
      const r = rects.length > 1 ? rects.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a)) : e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // the points a finger would land on: the middle, and towards each side (inside rounded corners)
      const pts = [[cx, cy], [r.left + r.width * .2, cy], [r.right - r.width * .2, cy], [cx, r.top + r.height * .2], [cx, r.bottom - r.height * .2]];
      const onScreen = pts.filter(([x, y]) => x >= 0 && y >= 0 && x < W && y < H);
      if (!onScreen.length) { if (!parked(e)) out.push(name(e, r) + ' off screen'); continue; }
      const hit = onScreen.filter(([x, y]) => own(e, x, y));
      if (!hit.length) {
        const h = document.elementFromPoint(onScreen[0][0], onScreen[0][1]);
        if (!h) continue;
        if (behindSheet(e, h)) continue;
        out.push(name(e, r) + ' under ' + label(coverOf(h)) + (coverOf(h) !== h ? ' (' + label(h) + ')' : ''));
        continue;
      }
      if (hit.length < onScreen.length) {
        const [x, y] = onScreen.find(([x, y]) => !own(e, x, y));
        const h = document.elementFromPoint(x, y);
        if (h && !behindSheet(e, h)) { out.push(name(e, r) + ' partly under ' + label(coverOf(h)) + (coverOf(h) !== h ? ' (' + label(h) + ')' : '')); continue; }
      }
      // partly off the screen (a box taller than the screen can't fit: its middle is what counts)
      if ((r.left < -1 || r.right > W + 1) || (r.height <= H && (r.top < -1 || r.bottom > H + 1))) { out.push(name(e, r) + ' partly off screen'); continue; }
      // cut off by a container that hides what overflows
      let clipped = null;
      for (let n = e.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.overflowX === 'visible' && s.overflowY === 'visible' && s.clipPath === 'none') continue;
        const pr = n.getBoundingClientRect();
        const cutX = s.overflowX !== 'visible' && (r.left < pr.left - 1 || r.right > pr.right + 1);
        const cutY = s.overflowY !== 'visible' && (r.top < pr.top - 1 || r.bottom > pr.bottom + 1);
        // (a box styled through its label shows as the label; a box bigger than the panel it scrolls in can't fit whole)
        const scrolls = (ov) => ov === 'auto' || ov === 'scroll';
        const tooBig = (cutY && scrolls(s.overflowY) && r.height > pr.height) || (cutX && scrolls(s.overflowX) && r.width > pr.width);
        if ((cutX || cutY) && !tooBig && ![...(e.labels || [])].includes(n)) { clipped = n; break; }
        if (s.position === 'fixed') break;
      }
      if (clipped) { out.push(name(e, r) + ' cut off by ' + label(clipped)); continue; }
      const miss = [[-21, 0], [21, 0], [0, -21], [0, 21]].filter(([dx, dy]) => { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= W || y >= H) return false; return !own(e, x, y); });
      // a puzzle board (Sudoku's 9 x 9) can't give every cell 44px on a phone: there its cells pass
      // when the board fills the width it has (as big as the screen allows); off screen, covered and
      // cut off still count
      const grid = e.closest('[data-tap-grid]');
      const fills = grid && grid.getBoundingClientRect().width >= 0.9 * Math.min(W - 16, grid.parentElement.clientWidth);
      if (miss.length && !fills) { const h = document.elementFromPoint(cx + miss[0][0], cy + miss[0][1]); out.push(name(e, r) + ' under 44px' + (h ? ` (${miss[0][0] ? (miss[0][0] < 0 ? 'left' : 'right') : miss[0][1] < 0 ? 'above' : 'below'}: ${label(h)})` : '')); }
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    return out;
  });
}

async function contrastIssues(page, sel = 'body') {
  const items = await page.evaluate((sel) => {
    const out = [];
    const onTop = (e, x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === e || e.contains(h)); };
    // words half cut off by a scrolling box (a sheet's bottom edge) aren't really showing: skip them
    const clipped = (e, r) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if (o === 'auto' || o === 'scroll' || o === 'hidden') { const q = p.getBoundingClientRect(); if (r.top < q.top - 1 || r.bottom > q.bottom + 1) return true; } } return false; };
    for (const s of document.querySelectorAll(sel)) {
      if (!s.getClientRects().length) continue;
      const walk = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      for (let n; (n = walk.nextNode());) {
        if (!n.textContent.trim()) continue;
        const e = n.parentElement, st = getComputedStyle(e);
        if (st.visibility === 'hidden' || e.closest('[hidden], [aria-hidden="true"], svg')) continue;
        const range = document.createRange(); range.selectNodeContents(n); const r = range.getBoundingClientRect();
        if (r.width < 4 || r.height < 6 || r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
        // (words partly under something else, a floating tab bar say, are only half showing: skip them)
        const inset = (k, a, b) => a + (b - a) * k;
        if (![[0.5, 0.5], [0.1, 0.15], [0.9, 0.15], [0.1, 0.85], [0.9, 0.85]].every(([kx, ky]) => onTop(e, inset(kx, r.left, r.right), inset(ky, r.top, r.bottom))) || clipped(e, r)) continue;
        out.push({ text: n.textContent.trim().slice(0, 30), color: st.color, size: parseFloat(st.fontSize), bold: +st.fontWeight >= 700, r: { x: r.left, y: r.top, w: r.width, h: r.height } });
      }
      for (const e of s.querySelectorAll('input[placeholder], textarea[placeholder]')) { // empty boxes show their placeholder
        if (e.value || !e.placeholder || !e.getClientRects().length) continue;
        const r = e.getBoundingClientRect(), st = getComputedStyle(e), ph = getComputedStyle(e, '::placeholder');
        if (r.top < 0 || r.bottom > innerHeight || r.width < 20 || !onTop(e, r.left + 12, r.top + r.height / 2)) continue;
        const pl = parseFloat(st.paddingLeft), fs = parseFloat(st.fontSize);
        out.push({ text: '[placeholder] ' + e.placeholder.slice(0, 24), color: ph.color, size: fs, bold: false, r: { x: r.left + pl, y: r.top + parseFloat(st.paddingTop), w: Math.max(4, Math.min(r.width - pl * 2, fs * e.placeholder.length * .5)), h: fs * 1.2 } });
      }
    }
    return out;
  }, sel);
  const hide = await page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } ::placeholder { color: transparent !important; }' });
  await page.waitForTimeout(150);
  const shot = (await page.screenshot()).toString('base64');
  await hide.evaluate((n) => n.remove());
  const bad = await page.evaluate(async ([shot, items]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + shot; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const k = img.width / innerWidth;
    const lum = ([r, gg, b]) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(gg) + .0722 * f(b); };
    const out = [];
    for (const it of items) {
      const d = g.getImageData(Math.round(it.r.x * k), Math.round(it.r.y * k), Math.max(1, Math.round(it.r.w * k)), Math.max(1, Math.round(it.r.h * k))).data;
      const [tr, tg, tb, ta = 1] = it.color.match(/[\d.]+/g).map(Number);
      let worst = 99;
      for (let i = 0; i < d.length; i += 4 * 7) { // a see-through colour is mixed over what is behind it
        const bg = [d[i], d[i + 1], d[i + 2]], fg = [tr * ta + bg[0] * (1 - ta), tg * ta + bg[1] * (1 - ta), tb * ta + bg[2] * (1 - ta)];
        const a = lum(fg), b = lum(bg);
        worst = Math.min(worst, (Math.max(a, b) + .05) / (Math.min(a, b) + .05));
      }
      const need = it.size >= 24 || (it.size >= 18.66 && it.bold) ? 3 : 4.5;
      if (worst < need) out.push(`"${it.text}" ${worst.toFixed(2)}:1, needs ${need}:1 (${it.color})`);
    }
    return out;
  }, [shot, items]);
  return { checked: items.length, bad };
}


/* ---------- taps that are slow or do nothing ---------- */
// in the page, once per load: notes when a finger lands, what changes after, long work, clicks
function installTapWatch() {
  if (window.__tw) return;
  const tw = window.__tw = { armed: null, t0: 0, change: 0, paint: 0, what: '', clicks: 0, longs: [], evs: [], all: [], noisy: new Set(), quiet: false };
  // when each part of the tap began to run (the app's own work is what follows it)
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click'].forEach((ev) => addEventListener(ev, () => { if (tw.armed) tw.evs.push(performance.now()); }, true));
  // things that change by themselves all the time (a clock, labels following a 3D model) are not a response
  new MutationObserver((list) => {
    const now = performance.now();
    for (const m of list) {
      if (m.type === 'attributes' && (/^data-tw/.test(m.attributeName) || m.oldValue === m.target.getAttribute(m.attributeName))) continue; // (set to what it was: nothing changed)
      if (tw.quiet) { tw.noisy.add(m.target); continue; }
      if (!tw.t0 || tw.noisy.has(m.target)) continue;
      // Cassie's cursor and her face follow every finger anywhere, the tutor's finger follows what it
      // points at, and a 3D picture's name tags follow the picture: that is not this control answering
      const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (el && (el.closest('#cassie-cursor, .tut-finger, .tut-ring, .lab3d-labels, .x3d-labels') || (el.closest('svg') && el.closest('svg').querySelector('.cb-all')))) continue;
      const onCassie = tw.armed && tw.armed.closest && tw.armed.closest('#mascot'); // (unless it was Cassie herself who was tapped)
      if (el && !onCassie && ((el.id === 'mascot' && m.type === 'attributes') || el.closest('#mascot-bubble'))) continue; // (the mascot gliding to its spot, and her bubble's own timer)
      if (m.type === 'attributes' && m.target.parentElement && tw.noisy.has(m.target.parentElement) && m.attributeName === 'style') continue;
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement, cls = (n) => (n && n.className && typeof n.className === 'string' ? '.' + n.className.split(' ')[0] : '');
      const desc = m.type + ' ' + (t ? t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + cls(t) + ' in ' + (t.parentElement ? t.parentElement.tagName.toLowerCase() + cls(t.parentElement) : '') : '') + (m.attributeName ? ' [' + m.attributeName + ': ' + String(m.oldValue).slice(0, 30) + ' → ' + String(m.target.getAttribute(m.attributeName)).slice(0, 30) + ']' : ' "' + String((t && t.textContent) || '').trim().slice(0, 30) + '"');
      if (tw.all.length < 80) tw.all.push(desc); // (everything that changed: to tell whether a drag did what a tap does)
      if (tw.change) continue;
      tw.change = now; tw.what = desc;
      requestAnimationFrame(() => { tw.paint = performance.now(); });
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true });
  const saw = (what) => { if (!tw.t0 || tw.change) return; tw.change = performance.now(); tw.what = what; requestAnimationFrame(() => { tw.paint = performance.now(); }); };
  // focus only shows on a box you type in (a caret); on a button a mouse click draws no focus ring
  ['focusin', 'input', 'change', 'toggle', 'scroll'].forEach((ev) => addEventListener(ev, (e) => { if (ev === 'focusin' && !(e.target.matches && e.target.matches('input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable]'))) return; saw(ev); }, true));
  addEventListener('pointerdown', (e) => { if (tw.armed && !tw.t0) tw.t0 = e.timeStamp; }, true);
  addEventListener('click', (e) => { if (tw.armed && e.isTrusted && (tw.armed.contains(e.target) || e.target === tw.armed)) tw.clicks++; }, true);
  try { new PerformanceObserver((l) => l.getEntries().forEach((x) => tw.longs.push([x.startTime, x.duration]))).observe({ type: 'longtask' }); } catch (e) { /* no long task timing */ }
}
// the controls on the screen now: anything you can tap or drag, each with a path to find it again
function controlsNow() {
  const W = innerWidth, H = innerHeight;
  const path = (e) => { const p = []; for (let n = e; n && n !== document.body; n = n.parentElement) { const i = n.parentElement ? [...n.parentElement.children].indexOf(n) : 0; p.unshift(`${n.tagName.toLowerCase()}:nth-child(${i + 1})`); } return 'body > ' + p.join(' > '); };
  const name = (e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''} "${(e.getAttribute('aria-label') || e.textContent.trim() || e.title || e.placeholder || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 28)}"`;
  const sel = 'button, a[href], [role=button], [role=tab], [role=radio], [role=switch], [role=checkbox], [role=slider], input:not([type=hidden]), select, textarea, summary, label, [draggable="true"], [tabindex="0"]';
  const set = new Set(document.querySelectorAll(sel));
  // anything else that looks tappable (a card with a click handler): the outermost box with a hand cursor
  for (const e of document.body.querySelectorAll('div, span, li, img, svg, canvas, figure, article, section')) {
    if (getComputedStyle(e).cursor !== 'pointer' && getComputedStyle(e).cursor !== 'grab') continue;
    if (e.parentElement && ['pointer', 'grab'].includes(getComputedStyle(e.parentElement).cursor)) continue;
    if (e.closest(sel)) continue;
    set.add(e);
  }
  const out = [];
  for (const e of set) {
    if (e.tagName === 'LABEL' && e.control && set.has(e.control)) continue; // (the box itself is tapped)
    if (!e.getClientRects().length) continue;
    const st = getComputedStyle(e);
    if (st.visibility === 'hidden' || +st.opacity === 0 || st.pointerEvents === 'none' || e.closest('[hidden], [inert], [aria-hidden="true"]')) continue;
    if (e.disabled || e.getAttribute('aria-disabled') === 'true' || (e.checkVisibility && !e.checkVisibility({ contentVisibilityAuto: true }))) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    // a panel parked off the screen (a closed side menu) is not on screen
    let parked = false;
    for (let n = e; n && n !== document.body; n = n.parentElement) { const q = n.getBoundingClientRect(), p = getComputedStyle(n).position; if ((p === 'fixed' || p === 'absolute') && (q.right <= 0 || q.left >= W || q.bottom <= 0 || q.top >= H)) { parked = true; break; } }
    if (parked) continue;
    const drag = e.matches('input[type=range], [draggable="true"], [role=slider]') || st.cursor === 'grab' || st.touchAction === 'none';
    out.push({ key: path(e), name: name(e), drag });
  }
  return out;
}
// get one control ready: in view, and is the place a finger lands really this control?
function aim(key) {
  const e = document.querySelector(key);
  if (!e) return null;
  e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const rects = [...e.getClientRects()];
  const r = rects.length > 1 ? rects.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a)) : e.getBoundingClientRect();
  const x = Math.max(1, Math.min(innerWidth - 2, r.left + r.width / 2)), y = Math.max(1, Math.min(innerHeight - 2, r.top + r.height / 2));
  const h = document.elementFromPoint(x, y);
  const own = !!h && (h === e || e.contains(h) || [...(e.labels || [])].some((l) => l.contains(h)) || (e.tagName === 'LABEL' && e.control === h)
    || (e.tagName === 'CANVAS' && h.tagName === 'CANVAS' && h.parentElement === e.parentElement)); // (a canvas laid over it on purpose takes its touches)
  // behind a sheet or dialog that covers most of the screen: not what's on screen now
  if (!own && h) {
    const dlg = h.closest('[role=dialog], [role=alertdialog]'); // (an open panel docked over part of the screen, like a bottom sheet)
    if (dlg && !dlg.contains(e)) return { behind: true };
    const W = innerWidth, H = innerHeight, big = (n) => { const q = n.getBoundingClientRect(); return q.width * q.height >= W * H * 0.6; };
    for (let n = h; n && n !== document.body; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if ((p === 'fixed' || p === 'absolute') && !n.contains(e) && big(n)) return { behind: true };
    }
  }
  const label = (n) => n ? `${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}${n.classList && n.classList.length ? '.' + [...n.classList].slice(0, 2).join('.') : ''}` : 'nothing';
  // the 300 ms delay: phones skip it on a page sized to the device, or a control with touch-action manipulation/none
  const vp = (document.querySelector('meta[name=viewport]') || {}).content || '';
  const ta = getComputedStyle(e).touchAction;
  // (only "auto" keeps double-tap-to-zoom, which is what makes a phone wait; on any element up to the page)
  let fast = /width=device-width/.test(vp);
  for (let n = e; n && fast; n = n.parentElement) if (getComputedStyle(n).touchAction === 'auto' && n === e) fast = false;
  // an option that is already the chosen one has nothing to change
  const chosen = document.activeElement === e || ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-current'].some((k) => ['true', 'page'].includes(e.getAttribute(k))) || (e.type === 'radio' && e.checked) || /(^| )(on|active|selected|current)( |$)/.test(typeof e.className === 'string' ? e.className : '');
  // a slider already at the spot tapped, and empty space on a picture you draw or drag on, have nothing to answer
  const surface = e.tagName === 'CANVAS' || e.matches('input[type=range]') || (e.tagName === 'LABEL' && !!e.querySelector('input[type=range]'));
  const onControl = !!h && !!h.closest('button, a[href], [role=button], input, label');
  return { onControl, surface, chosen, x, y, w: r.width, h: r.height, own, cover: own ? '' : label(h) + (h && h.closest('[class]') && h.closest('[class]') !== h ? ' in ' + label(h.closest('[class]')) : ''), fast, ta };
}
function arm(key) {
  const tw = window.__tw;
  // a live 3D picture (three.js) on screen when the finger lands: this test machine draws it in
  // software, hundreds of times slower than a phone's graphics chip, and the browser holds the tap
  // until a frame is drawn, so only the app's own work after the tap is timed there
  tw.gl = [...document.querySelectorAll('canvas[data-engine]')].some((c) => c.getClientRects().length && !c.closest('[hidden]'));
  tw.armed = document.querySelector(key); tw.t0 = 0; tw.change = 0; tw.paint = 0; tw.what = ''; tw.clicks = 0; tw.longs = []; tw.evs = []; tw.all = [];
}
const quiet = (on) => { window.__tw.quiet = on; if (on) window.__tw.noisy = new Set(window.__tw.steady || []); };
// things that change by themselves every second or so (a puzzle's clock): watched for longer when a screen opens
// (only what changes in two windows one after the other: a screen still finishing a one-off change isn't a clock)
// Learned once per screen, then found again by where they sit when the screen is opened again.
async function learnSteady(page, known) {
  if (known) { await page.evaluate((keys) => { window.__tw.steady = keys.map((k) => { try { return document.querySelector(k); } catch (e) { return null; } }).filter(Boolean); }, known); return known; }
  await page.evaluate(() => { window.__tw.steady = []; window.__tw.quiet = true; window.__tw.noisy = new Set(); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__tw.first = window.__tw.noisy; window.__tw.noisy = new Set(); });
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const tw = window.__tw; tw.steady = [...tw.noisy].filter((n) => tw.first.has(n)); tw.quiet = false;
    const path = (e) => { const p = []; for (let n = e; n && n !== document.body; n = n.parentElement) { if (!n.parentElement) return null; p.unshift(`${n.tagName.toLowerCase()}:nth-child(${[...n.parentElement.children].indexOf(n) + 1})`); } return 'body > ' + p.join(' > '); };
    return tw.steady.map((n) => (n.nodeType === 1 ? n : n.parentElement)).filter(Boolean).map(path).filter(Boolean);
  });
}
function readout() {
  const tw = window.__tw;
  const gl = tw.gl;
  const work = tw.change ? Math.round(tw.change - Math.max(0, ...tw.evs.filter((t) => t <= tw.change))) : null;
  const r = { all: tw.all.slice(), gl, work, t0: tw.t0, change: tw.change, paint: tw.paint, what: tw.what, clicks: tw.clicks, longs: tw.longs.filter(([s, d]) => tw.t0 && s >= tw.t0 - 5 && s < tw.t0 + 1000 && d > 100).map(([, d]) => Math.round(d)) }; tw.armed = null; return r;
}

// a screen opened afresh, finished loading: no long work for 400 ms (at most 4 s). Its own first frames
// are the page loading, not a tap being answered: on this machine (no graphics chip) a moving 3D
// background's first frames are copied back by hand, a 140 ms freeze no phone or computer has.
function settled() {
  return new Promise((done) => {
    let last = performance.now();
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { last = Math.max(last, e.startTime + e.duration); })).observe({ type: 'longtask', buffered: true }); } catch (e) { /* no long task timing */ }
    const t0 = performance.now();
    const check = () => (document.readyState === 'complete' && performance.now() - last > 400) || performance.now() - t0 > 4000 ? done() : setTimeout(check, 50);
    check();
  });
}
// o: { reopen: async () => page (the screen opened fresh), touch: bool, cdp: for touch drags, skip: RegExp of names not to tap,
//      settle: wait for a reopened screen to finish loading before the next tap (a page with heavy first frames) }
async function tapResponseIssues(page, o) {
  const out = [];
  // a file picker, a download or a new tab opening is the tap answering too (they are not in the page)
  let outside = false;
  const away = () => { outside = true; };
  const watch = (pg) => { pg.on('filechooser', away); pg.on('download', away); pg.on('popup', away); pg.on('dialog', away); };
  watch(page);
  // the screen's shape (not its numbers): a tap that changes a readout doesn't need the screen opened again
  const sig = async (pg) => (await pg.evaluate(controlsNow)).map((c) => c.key).join('|') + '@' + pg.url();
  await page.evaluate(installTapWatch);
  const steadyKeys = await learnSteady(page);
  let list = (await page.evaluate(controlsNow)).filter((c) => !o.only || o.only.has(c.key));
  // o.scope: only controls inside what this selector matches (a lab's top bar and the card that's open, say)
  // (in the order the selectors are listed: the first part's controls first)
  if (o.scope) {
    const where = await page.evaluate(([keys, sels]) => keys.map((k) => { const e = document.querySelector(k); return e ? sels.findIndex((sel) => e.closest(sel)) : -1; }), [list.map((c) => c.key), o.scope.split(',').map((x) => x.trim())]);
    list = list.map((c, i) => [c, where[i]]).filter(([, w]) => w >= 0).sort((a, b) => a[1] - b[1]).map(([c]) => c);
  }
  // o.max: at most this many controls in all (after the rules above)
  if (o.max && !o.only) list = list.slice(0, o.max);
  // o.seen: controls already checked on another screen (the tab bar is on almost every one) are not tapped again
  if (o.seen && !o.only) list = list.filter((c) => { if (o.seen.has(c.name)) return false; o.seen.add(c.name); return true; });
  // o.perKind: at most this many controls of the same kind (the same tag and classes) on a screen
  if (o.perKind && !o.only) { const seen = new Map(); list = list.filter((c) => { const t = c.name.split(' ')[0], k = /^[a-z]+$/.test(t) ? c.name : t; /* (plain buttons: each its own kind) */ seen.set(k, (seen.get(k) || 0) + 1); return seen.get(k) <= o.perKind; }); }
  let base = await sig(page), dirty = false;
  for (const c of list) {
    if (o.skip && o.skip.test(c.name)) continue;
    // a sheet or card the tap opened usually closes with Escape: much quicker than opening the screen again
    if (dirty && !page.isClosed()) { try { await page.keyboard.press('Escape'); await page.waitForTimeout(250); if ((await sig(page)) === base) dirty = false; } catch (e) { /* open it again */ } }
    if (dirty) { const was = page; page = await o.reopen(); if (page !== was) watch(page); if (o.settle) await page.evaluate(settled); await page.evaluate(installTapWatch); await learnSteady(page, steadyKeys); base = await sig(page); dirty = false; }
    let a;
    try { a = await page.evaluate(aim, c.key); } catch (e) { dirty = true; continue; }
    if (!a || a.behind) continue; // (gone: this screen has changed by itself; or under a sheet)
    if (!a.own && a.surface && a.onControl) continue; // (a picture with a label or button of its own on top: that is what's tapped there)
    if (!a.own) { out.push({ key: c.key, cause: 'covered', what: `${c.name}: the tap lands on ${a.cover}` }); continue; }
    if (o.touch && !a.fast) out.push({ key: c.key, cause: 'tap delay', what: `${c.name}: touch-action ${a.ta}` });
    // a moment to see what changes by itself, then the tap
    await page.evaluate(quiet, true); await page.waitForTimeout(100); await page.evaluate(quiet, false);
    await page.evaluate(arm, c.key);
    // a 3D picture: what it shows before the tap (some buttons only move the picture)
    // (a picture on screen, 3D or flat: some buttons only change what it shows)
    const glBox = await page.evaluate(() => { const cv = [...document.querySelectorAll('canvas')].find((x) => { const q = x.getBoundingClientRect(); return q.width > 60 && q.height > 60 && !x.closest('[hidden]') && q.bottom > 0 && q.top < innerHeight; }); if (!cv) return null; const q = cv.getBoundingClientRect(); return { x: Math.max(0, q.left), y: Math.max(0, q.top), width: Math.min(innerWidth, q.right) - Math.max(0, q.left), height: Math.min(innerHeight, q.bottom) - Math.max(0, q.top) }; });
    const before = glBox ? await page.screenshot({ clip: glBox }).catch(() => null) : null;
    outside = false;
    const url0 = page.url();
    try {
      if (o.touch) await page.touchscreen.tap(a.x, a.y); else await page.mouse.click(a.x, a.y);
    } catch (e) { dirty = true; continue; }
    // until it shows (or 300 ms: three times slower than it should be), then a moment for long work to be seen
    await page.waitForFunction(() => window.__tw.paint || (window.__tw.gl && window.__tw.change), null, { timeout: 300, polling: 16 }).catch(() => {});
    await page.waitForTimeout(120);
    let r;
    try { r = await page.evaluate(readout); } catch (e) { dirty = true; continue; } // (it went to another page: that's a response)
    let ms = r.gl ? r.work : r.paint ? Math.round(r.paint - r.t0) : r.change ? Math.round(r.change - r.t0) + 150 : null; // (changed, but not yet drawn 150 ms later)
    if (outside || page.url() !== url0) { ms = 0; r.what = 'opened outside the page'; }
    if (ms === null && before) { const after = await page.screenshot({ clip: glBox }).catch(() => null); if (after && !after.equals(before)) { ms = 0; r.what = 'the picture changed'; } }
    if (ms > 100 && a.chosen && !r.longs.length) ms = null; // (already chosen: a later change is something else's)
    if (o.log) o.log(`${c.name}: ${ms === null ? 'no change' : ms + ' ms'} ${r.what}${r.longs.length ? ' long ' + r.longs.join('+') : ''}`);
    if (!r.t0) out.push({ key: c.key, cause: 'covered', what: `${c.name}: the finger never reached it` });
    else if (ms === null && (a.chosen || a.surface)) { /* already chosen, or a slider tapped at its own value, or empty space on a picture */ }
    else if (ms === null) out.push({ key: c.key, cause: 'no response', what: `${c.name}: nothing changed on screen` });
    else if (ms > 100) out.push({ key: c.key, cause: 'slow', what: `${c.name}: ${ms} ms (${r.what})` });
    if (r.longs.length && !r.gl) out.push({ key: c.key, cause: 'blocked', what: `${c.name}: the page froze for ${r.longs.join(' + ')} ms` });
    if (r.clicks > 1) out.push({ key: c.key, cause: 'double', what: `${c.name}: one tap, ${r.clicks} clicks` });
    // a drag on something you can drag must not also count as a tap
    if (c.drag && !dirty && !c.name.startsWith('canvas')) { // (a picture's own drags mean something there: its lab's tests cover them)
      let a2; try { a2 = await page.evaluate(aim, c.key); } catch (e) { a2 = null; }
      if (a2 && a2.own && !(await page.evaluate((k) => document.querySelector(k).matches('input[type=range]'), c.key))) {
        await page.evaluate(arm, c.key);
        const dx = Math.min(60, a2.w / 2 + 30);
        if (o.touch) {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a2.x, y: a2.y }] });
          for (let k = 1; k <= 6; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a2.x + (dx * k) / 6, y: a2.y }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await cdp.detach();
        } else {
          await page.mouse.move(a2.x, a2.y); await page.mouse.down(); await page.mouse.move(a2.x + dx, a2.y, { steps: 6 }); await page.mouse.up();
        }
        await page.waitForTimeout(300);
        let d; try { d = await page.evaluate(readout); } catch (e) { d = { clicks: 0 }; }
        // (a click event after a drag is normal; what matters is whether the app then did what a tap does)
        if (r.what && d.all && d.all.includes(r.what)) out.push({ key: c.key, cause: 'drag taps', what: `${c.name}: a drag did what a tap does (${r.what})` });
        dirty = true;
      }
    }
    if (!dirty) { try { dirty = (await sig(page)) !== base; } catch (e) { dirty = true; } }
  }
  // A tap measured slow, or a freeze, is measured twice more (the screen opened afresh each time): it
  // counts only if it happens in at least 2 of the 3, the typical result. A real slowdown shows up
  // every time; a one-off hiccup of this (graphics-chip-less) test machine does not.
  const timing = out.filter((i) => i.cause === 'slow' || i.cause === 'blocked');
  if (timing.length && o.reopen && !o.recheck) {
    const keys = new Set(timing.map((i) => i.key)), again = [];
    for (let k = 0; k < 2; k++) {
      try { page = await o.reopen(); again.push(await tapResponseIssues(page, { ...o, only: keys, recheck: true })); } catch (e) { again.push(timing); }
    }
    return out.filter((i) => !timing.includes(i) || again.filter((r) => r.some((j) => j.key === i.key && j.cause === i.cause)).length >= 1);
  }
  return out;
}

module.exports = { tapTargetIssues, contrastIssues, tapResponseIssues };

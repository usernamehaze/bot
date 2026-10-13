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
                                  and each word's colour is measured against what was behind it */

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
      e.scrollIntoView({ block: 'center', inline: 'nearest' });
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
    window.scrollTo(0, 0);
    return out;
  });
}

async function contrastIssues(page, sel = 'body') {
  const items = await page.evaluate((sel) => {
    const out = [];
    const onTop = (e, x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === e || e.contains(h)); };
    for (const s of document.querySelectorAll(sel)) {
      if (!s.getClientRects().length) continue;
      const walk = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      for (let n; (n = walk.nextNode());) {
        if (!n.textContent.trim()) continue;
        const e = n.parentElement, st = getComputedStyle(e);
        if (st.visibility === 'hidden' || e.closest('[hidden], [aria-hidden="true"], svg')) continue;
        const range = document.createRange(); range.selectNodeContents(n); const r = range.getBoundingClientRect();
        if (r.width < 4 || r.height < 6 || r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
        if (!onTop(e, r.left + r.width / 2, r.top + r.height / 2)) continue;
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

module.exports = { tapTargetIssues, contrastIssues };

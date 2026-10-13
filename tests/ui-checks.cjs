/* Checks on a screen as it shows, used by the design smoke tests.
     tapTargetIssues(page)      → controls whose touch area is smaller than 44 x 44 (each is scrolled
                                  into view; points 21px out from its centre must still land on it)
     contrastIssues(page, sel)  → words under WCAG AA against the real pixels behind them (glass over
                                  the marble): the screen is shot once with every word made invisible,
                                  and each word's colour is measured against what was behind it */

async function tapTargetIssues(page) {
  return page.evaluate(() => {
    const out = [];
    const all = document.querySelectorAll('button, a[href], [role=button], [role=tab], input:not([type=hidden]), select, textarea, summary');
    for (const e of all) {
      if (!e.getClientRects().length) continue;
      const st = getComputedStyle(e);
      if (st.visibility === 'hidden' || +st.opacity === 0 || e.closest('[hidden], [inert], [aria-hidden="true"]')) continue;
      e.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = e.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) continue;
      const top = document.elementFromPoint(cx, cy);
      if (!top || !(top === e || e.contains(top))) continue; // covered by something else: not tappable here anyway
      const own = (x, y) => { if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true; const h = document.elementFromPoint(x, y); return !!h && (h === e || e.contains(h)); };
      const miss = [[-21, 0], [21, 0], [0, -21], [0, 21]].filter(([dx, dy]) => !own(cx + dx, cy + dy));
      if (miss.length) out.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.classList.length ? '.' + [...e.classList].join('.') : ''} "${(e.getAttribute('aria-label') || e.textContent || e.placeholder || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
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

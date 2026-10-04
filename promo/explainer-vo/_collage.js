  function collageCards(r) {
    const C = [
      ['<div class="lbl">PDF · 412 pages</div><div style="height:8px;background:#eee;border-radius:4px;margin-top:10px"></div><div style="height:8px;background:#eee;border-radius:4px;margin-top:8px;width:70%"></div>', 150, 110, '#fff'],
      ['<div class="lbl" style="color:#fff">SLIDES</div><div style="height:46px;background:rgba(255,255,255,.25);border-radius:6px;margin-top:8px"></div>', 150, 100, '#5b4bd8'],
      ['<div style="font:700 15px Inter">“Explain the Krebs cycle??”</div>', 170, 70, '#fff3b0'],
      ['<svg viewBox="0 0 100 50" width="130" height="60"><path d="M5 45 L30 30 L50 35 L75 12 L95 8" stroke="#d8343c" stroke-width="4" fill="none"/></svg>', 150, 90, '#fff'],
      ['<div style="font:900 34px Inter;color:#16131c">23:59</div><div class="lbl">due tonight</div>', 140, 90, '#ffd6dc'],
      ['<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px">' + '<i style="height:18px;background:#ddd;border-radius:4px"></i>'.repeat(9) + '</div>', 120, 100, '#e9e4ff'],
      ['<div style="width:100%;height:56px;border-radius:8px;background:linear-gradient(135deg,#222,#555);display:grid;place-items:center;color:#fff;font:900 22px Inter">▶</div><div class="lbl" style="margin-top:6px">lecture 7 · 1:42:10</div>', 160, 100, '#fff'],
      ['<div style="font:800 15px Inter">Flashcard</div><div style="font:600 14px Inter;color:#6f6a76;margin-top:6px">mitochondria = ?</div>', 140, 80, '#fff'],
      ['<div style="font:800 26px Inter">∫ x² dx</div>', 120, 70, '#d9f2e6'],
      ['<div style="font:700 14px Inter">37 tabs open</div><div style="display:flex;gap:3px;margin-top:8px">' + '<i style="flex:1;height:10px;background:#c8c3d0;border-radius:3px"></i>'.repeat(6) + '</div>', 150, 64, '#fff'],
    ];
    return C.map(([html, w, h, bg]) => make(`<div class="card2" style="width:${w}px;height:${h}px;padding:12px;background:${bg}">${html}</div>`, r));
  }

  /* ---------------- seek ---------------- */
  CassieStage.mount($('#stage'));
  const flash = $('#flash');
  window.seek = function (t) {
    const s = scenes.find((x) => t >= x.t0 && t < x.t1) || scenes[scenes.length - 1];
    scenes.forEach((x) => { const on = x === s; x.root.style.display = on ? 'block' : 'none'; x.tags.forEach((g) => { g.style.display = on ? '' : 'none'; }); });
    const lt = t - s.t0;
    const k = span(lt, 0, 0.32);
    s.root.style.filter = k < 1 ? `blur(${(1 - k) * 16}px)` : 'none';
    s.root.style.transform = `scale(${lerp(1.04, 1, out3(k))})`;
    s.update(lt, s.d);
    s.tags.forEach((g) => { g.style.opacity = span(lt, 0.1, 0.3); });
    flash.style.opacity = (1 - span(lt, 0, 0.12)) * 0.45 * (t > 0.1 ? 1 : 0);
    chrome(t, s);
    CassieStage.set(s.cast ? s.cast(lt) : []);
    CassieStage.frame(t);
  };
  (function wait() { if (CassieStage.isReady()) { window.seek(0); window.READY = true; } else setTimeout(wait, 50); })();
})();

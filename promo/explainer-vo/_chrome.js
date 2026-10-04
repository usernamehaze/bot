  /* ---------------- frame chrome: glow, wave, chapters, ruler ---------------- */
  const glow = $('#glow');
  const blobs = [0, 1, 2, 3, 4].map(() => make('<i></i>', glow));
  const wave = $('#wave'), wg = wave.getContext('2d');
  wave.style.width = '1000px'; wave.style.height = '300px'; wave.style.filter = 'blur(10px)';
  const chs = [...document.querySelectorAll('#chapters div')];
  const ruler = $('#ruler');
  const ticks = Array.from({ length: 60 }, (_, i) => make(`<i class="${i % 5 === 0 ? 'big' : ''}"></i>`, ruler));
  const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  let palNow = null;
  function chrome(t, s) {
    const target = PAL[s ? s.pal : 'red'].map(hexRGB);
    if (!palNow) palNow = target.map((c) => c.slice());
    palNow = palNow.map((c, i) => c.map((v, j) => v + (target[i][j] - v) * 0.12));
    const rgba = (i, a) => `rgba(${palNow[i].map(Math.round).join(',')},${a})`;
    // glow under the card
    blobs.forEach((b, i) => {
      const x = 230 + i * 220 + Math.sin(t * 0.6 + i) * 70, y = 170 + Math.cos(t * 0.5 + i * 1.7) * 50 + (i % 2) * 90;
      Object.assign(b.style, { left: x - 300 + 'px', top: y - 210 + 'px', width: '600px', height: '420px', background: rgba(i % 3, 1) });
    });
    // soft wave at the bottom of the card
    wg.clearRect(0, 0, 500, 150);
    for (let i = 0; i < 70; i++) {
      const x = i * 7.3, h = 30 + 45 * (0.5 + 0.5 * Math.sin(i * 0.45 + t * 2.2)) * (0.6 + 0.4 * Math.sin(i * 0.13 - t));
      const gr = wg.createLinearGradient(0, 150 - h, 0, 150);
      gr.addColorStop(0, rgba(i % 2 ? 1 : 0, 0)); gr.addColorStop(1, rgba(i % 2 ? 1 : 0, 0.55));
      wg.fillStyle = gr; wg.fillRect(x, 150 - h, 9, h);
    }
    wave.style.opacity = s && s.root.style.background ? 0.35 : 0.9;
    // chapters
    chs.forEach((c, i) => {
      const [a, b] = CH[i], on = t >= a && t < b;
      c.classList.toggle('on', on);
      const st = $('.streak', c);
      st.style.opacity = on ? 1 : 0; st.style.left = `calc(${span(t, a, b) * 100}% - 5px)`;
    });
    ticks.forEach((tk, i) => { tk.style.left = ((i * 24 - t * 60) % 1440 + 1440) % 1440 - 200 + 'px'; });
  }


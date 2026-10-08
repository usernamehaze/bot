/* More physics labs: colour (light and ink), magnetic fields, lenses and mirrors, logic gates,
   and a rocket you build and launch. */
import { INK, DIM, FAINT, GRID, C, el, esc, num, canvas, drag, at, clock, group, slider, seg, button, row, stats, line, dot, text, arrow, overlay } from './kit.js';
import { NAMES as COLOUR_NAMES, nameColour, describeColour } from './colornames.js';
import { webglOk } from './three-kit.js';

/* ---------------- Colour ---------------- */
const hex2 = (v) => Math.round(v).toString(16).padStart(2, '0');
function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, mx ? d / mx : 0, mx];
}
function hsv2rgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function rgb2cmyk(r, g, b) {
  const k = 1 - Math.max(r, g, b) / 255;
  if (k >= 1) return [0, 0, 0, 1];
  return [(1 - r / 255 - k) / (1 - k), (1 - g / 255 - k) / (1 - k), (1 - b / 255 - k) / (1 - k), k];
}
const colourLab = {
  id: 'colour', name: 'Colour mixer', subject: 'physics', topic: 'colour: additive mixing of light (RGB), subtractive mixing of ink (CMYK), and hue, saturation and value',
  blurb: 'Mix coloured light, mix inks, or pick from the wheel — and see the same colour in RGB, CMYK and HSV.',
  words: 'colour color rgb cmyk hsv light ink pigment additive subtractive hue screen printer',
  icon: '<circle cx="18" cy="18" r="10"/><circle cx="30" cy="18" r="10"/><circle cx="24" cy="29" r="10"/>',
  tries: ['Make yellow using only red and green light', 'Make white light', 'Find the hue (in degrees) of pure blue'],
  hints: ['Choose “Light (RGB)”. Turn red and green all the way up and blue all the way down.', 'In “Light (RGB)”, turn all three colours of light up fully.', 'Choose “Wheel (HSV)” and tap the blue part of the ring. Read the hue in degrees.'],
  about: 'Screens make colours by adding red, green and blue light (additive mixing): all three at full strength make white.\nInks and paints work the other way (subtractive mixing): cyan, magenta and yellow each absorb some colours from white light. Printers add black (K) because mixing the three inks gives a muddy dark brown, not a true black.\nCMYK here uses the simple textbook formula K = 1 − max(R, G, B); real printers adjust colours with colour profiles, so printed results differ a little.\nHue is the angle round the colour wheel: red 0°, green 120°, blue 240°.',
  mount({ stage, panel, api }) {
    let mode = 'light', R = 255, G = 160, B = 40;
    let wheel = null;
    const cv = canvas(stage, (ctx, w, h) => {
      const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.2;
      if (mode === 'light') {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';
        [[R, 0, 0, -0.5], [0, G, 0, 0.5], [0, 0, B, 1.5]].forEach(([rr, gg, bb, k]) => {
          const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
          ctx.fillStyle = `rgb(${rr},${gg},${bb})`; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r, 0, Math.PI * 2); ctx.fill();
        });
        ctx.globalCompositeOperation = 'source-over';
        text(ctx, 'red', cx + Math.cos(-Math.PI / 2 - Math.PI / 3) * r * 1.9, cy + Math.sin(-Math.PI / 2 - Math.PI / 3) * r * 1.9, DIM, 'center');
        text(ctx, 'green', cx + Math.cos(-Math.PI / 6) * r * 1.9, cy + Math.sin(-Math.PI / 6) * r * 1.9, DIM, 'center');
        text(ctx, 'blue', cx, cy + r * 1.95, DIM, 'center');
        text(ctx, 'Coloured spotlights on a dark wall: where they overlap, light adds up', w / 2, h - 12, DIM, 'center');
      } else if (mode === 'ink') {
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        const [c, m, y, k] = rgb2cmyk(R, G, B);
        ctx.globalCompositeOperation = 'multiply';
        [[[255 * (1 - c), 255, 255], -0.5, 'cyan'], [[255, 255 * (1 - m), 255], 0.5, 'magenta'], [[255, 255, 255 * (1 - y)], 1.5, 'yellow']].forEach(([[rr, gg, bb], kk]) => {
          const a = -Math.PI / 2 + (kk * Math.PI * 2) / 3;
          ctx.fillStyle = `rgb(${rr | 0},${gg | 0},${bb | 0})`; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r, 0, Math.PI * 2); ctx.fill();
        });
        ctx.fillStyle = `rgb(${255 * (1 - k) | 0},${255 * (1 - k) | 0},${255 * (1 - k) | 0})`; ctx.beginPath(); ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        text(ctx, 'Inks on white paper: each ink takes some colours away (+ black in the middle)', w / 2, h - 12, '#555', 'center');
      } else {
        const [hh, ss, vv] = rgb2hsv(R, G, B), ro = Math.min(w, h) * 0.42, ri = ro * 0.78, sq = ri * 1.25;
        for (let a = 0; a < 360; a += 1) { ctx.strokeStyle = `hsl(${a},100%,50%)`; ctx.lineWidth = ro - ri; ctx.beginPath(); ctx.arc(cx, cy, (ro + ri) / 2, ((a - 90.6) * Math.PI) / 180, ((a - 89) * Math.PI) / 180); ctx.stroke(); }
        // saturation (across) and value (up) for this hue
        const x0 = cx - sq / 2, y0 = cy - sq / 2;
        const gS = ctx.createLinearGradient(x0, 0, x0 + sq, 0); gS.addColorStop(0, '#fff'); const [hr, hg, hb] = hsv2rgb(hh, 1, 1); gS.addColorStop(1, `rgb(${hr | 0},${hg | 0},${hb | 0})`);
        ctx.fillStyle = gS; ctx.fillRect(x0, y0, sq, sq);
        const gV = ctx.createLinearGradient(0, y0, 0, y0 + sq); gV.addColorStop(0, 'rgba(0,0,0,0)'); gV.addColorStop(1, '#000');
        ctx.fillStyle = gV; ctx.fillRect(x0, y0, sq, sq);
        const ha = ((hh - 90) * Math.PI) / 180;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx + Math.cos(ha) * (ro + ri) / 2, cy + Math.sin(ha) * (ro + ri) / 2, (ro - ri) / 2 + 2, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x0 + ss * sq, y0 + (1 - vv) * sq, 8, 0, Math.PI * 2); ctx.stroke();
        wheel = { cx, cy, ro, ri, x0, y0, sq };
        text(ctx, 'Tap the ring for the hue, the square for saturation and brightness', w / 2, h - 12, DIM, 'center');
      }
    });
    function pickAt(p) {
      if (mode !== 'wheel' || !wheel) return;
      const { cx, cy, ro, ri, x0, y0, sq } = wheel, d = Math.hypot(p.x - cx, p.y - cy);
      let [hh, ss, vv] = rgb2hsv(R, G, B);
      if (d > ri - 4 && d < ro + 12) hh = ((Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90 + 360) % 360;
      else if (p.x >= x0 - 10 && p.x <= x0 + sq + 10 && p.y >= y0 - 10 && p.y <= y0 + sq + 10) { ss = Math.max(0, Math.min(1, (p.x - x0) / sq)); vv = Math.max(0, Math.min(1, 1 - (p.y - y0) / sq)); if (!ss) ss = 0.0001; }
      else return;
      [R, G, B] = hsv2rgb(hh, ss, vv).map(Math.round); sync();
    }
    drag(cv.c, { down: pickAt, move: pickAt });
    const swatch = el('div', 'lab-swatch'); panel.appendChild(swatch);
    // tap a named colour to try it
    const QUICK = ['Red', 'Orange', 'Yellow', 'Lime', 'Green', 'Teal', 'Cyan', 'Sky blue', 'Blue', 'Navy', 'Purple', 'Magenta', 'Pink', 'Brown', 'Gold', 'Silver', 'Gray', 'Black', 'White', 'Burgundy', 'Mustard', 'Lilac', 'Peach', 'Mint green'];
    const chips = el('div', 'lab-colour-chips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Named colours');
    chips.innerHTML = QUICK.map((n) => { const h = COLOUR_NAMES.find(([x]) => x === n)[1]; return `<button type="button" data-hex="${h}" title="${n}" aria-label="${n}" style="background:${h}"></button>`; }).join('');
    chips.addEventListener('click', (e) => { const b = e.target.closest('[data-hex]'); if (!b) return; const h = b.dataset.hex; [R, G, B] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); sync(); });
    group(panel, 'Named colours').appendChild(chips);
    seg(group(panel, 'Model'), { options: [['light', 'Light (RGB)'], ['ink', 'Ink (CMYK)'], ['wheel', 'Wheel (HSV)']], value: mode, onChange: (v) => { mode = v; build(); sync(); } });
    const box = el('div'); panel.appendChild(box);
    let sliders = [];
    function build() {
      box.replaceChildren(); sliders = [];
      const g = group(box, mode === 'light' ? 'Light' : mode === 'ink' ? 'Ink' : 'Hue, saturation, value');
      if (mode === 'light') [['Red', 0], ['Green', 1], ['Blue', 2]].forEach(([n, i]) => sliders.push(slider(g, { label: n, min: 0, max: 255, value: [R, G, B][i], onInput: (v) => { if (i === 0) R = v; else if (i === 1) G = v; else B = v; sync(true); } })));
      else if (mode === 'ink') {
        const cmyk = rgb2cmyk(R, G, B);
        ['Cyan', 'Magenta', 'Yellow', 'Black (K)'].forEach((n, i) => sliders.push(slider(g, { label: n, min: 0, max: 100, value: Math.round(cmyk[i] * 100), fmt: (v) => v + '%', onInput: () => { const [c, m, y, k] = sliders.map((s) => s.value / 100); R = Math.round(255 * (1 - c) * (1 - k)); G = Math.round(255 * (1 - m) * (1 - k)); B = Math.round(255 * (1 - y) * (1 - k)); sync(true); } })));
      } else {
        const hsv = rgb2hsv(R, G, B);
        [['Hue', 360, hsv[0], '°'], ['Saturation', 100, hsv[1] * 100, '%'], ['Value (brightness)', 100, hsv[2] * 100, '%']].forEach(([n, mx, v, u]) => sliders.push(slider(g, { label: n, min: 0, max: mx, value: Math.round(v), fmt: (x) => x + u, onInput: () => { const [hh, ss, vv] = sliders.map((s) => s.value); [R, G, B] = hsv2rgb(hh % 360, ss / 100, vv / 100).map(Math.round); sync(true); } })));
      }
    }
    function sync(fromSliders) {
      const [hh, ss, vv] = rgb2hsv(R, G, B), [c, m, y, k] = rgb2cmyk(R, G, B), hex = '#' + hex2(R) + hex2(G) + hex2(B);
      const named = nameColour([R, G, B]), looks = describeColour([R, G, B]), ink = vv > 0.6 && ss < 0.6 ? '#111' : '#fff';
      swatch.style.background = hex;
      swatch.innerHTML = `<b style="color:${ink}">${named.exact ? '' : named.close ? 'about ' : 'nearest: '}${esc(named.name)}</b><small style="color:${ink}">${esc(looks)} · ${hex.toUpperCase()}</small>`;
      if (!fromSliders) {
        if (mode === 'light') sliders.forEach((s, i) => s.set([R, G, B][i]));
        else if (mode === 'ink') sliders.forEach((s, i) => s.set(Math.round([c, m, y, k][i] * 100)));
        else sliders.forEach((s, i) => s.set(Math.round([hh, ss * 100, vv * 100][i])));
      }
      st.set([['Name', named.exact ? named.name : `${named.close ? 'about' : 'nearest'} ${named.name} (${named.hex.toUpperCase()})`], ['Looks', looks], ['RGB', `${R}, ${G}, ${B}`], ['Hex', hex.toUpperCase()], ['CMYK', `${Math.round(c * 100)}%, ${Math.round(m * 100)}%, ${Math.round(y * 100)}%, ${Math.round(k * 100)}%`], ['HSV', `${Math.round(hh)}°, ${Math.round(ss * 100)}%, ${Math.round(vv * 100)}%`]]);
      if (mode === 'light' && R > 240 && G > 240 && B < 15) api.check(0);
      if (mode === 'light' && R > 245 && G > 245 && B > 245) api.check(1);
      if (mode === 'wheel' && Math.abs(hh - 240) <= 2 && ss > 0.9 && vv > 0.9) api.check(2);
      cv.redraw();
    }
    const st = stats(panel);
    build(); sync();
    return { state: () => { const [hh, ss, vv] = rgb2hsv(R, G, B); return `mixing ${mode === 'light' ? 'light' : mode === 'ink' ? 'inks' : 'on the colour wheel'}: the colour is ${nameColour([R, G, B]).name} (${describeColour([R, G, B])}), RGB ${R}, ${G}, ${B} (#${hex2(R)}${hex2(G)}${hex2(B)}), hue ${Math.round(hh)}°, saturation ${Math.round(ss * 100)}%, value ${Math.round(vv * 100)}%`; }, destroy: () => cv.destroy() };
  },
};

/* ---------------- Magnetic field ---------------- */
const magnetLab = {
  id: 'magnets', name: 'Magnetic field', subject: 'physics', topic: 'magnetic fields: bar magnets, field lines, compasses and the field around a current-carrying wire',
  blurb: 'Drag magnets and wires around, watch the field lines, and read the field with a compass.',
  words: 'magnet magnetic field lines compass north south pole electromagnetism wire current right hand rule',
  icon: '<path d="M10 30V18a14 14 0 0 1 28 0v12"/><rect x="6" y="30" width="8" height="10"/><rect x="34" y="30" width="8" height="10"/><path d="M24 8v-4M18 10l-2-3M30 10l2-3"/>',
  tries: ['Line up two magnets, N facing S — watch the lines join', 'Put two wires side by side with currents in opposite directions', 'Move the compass in a circle round a wire'],
  hints: ['Tap “+ Magnet”, then drag the second magnet so its N end nearly touches the first one’s S end. Tap a magnet to turn it.', 'Tap “+ Wire” twice, then tap one wire to flip its current (⊙ ↔ ⊗).', 'Drag the compass close to a wire and move it round. Watch which way its red end points.'],
  about: 'A flat (2D) slice through a 3D field. Each bar magnet is modelled as a north pole and a south pole at its ends (the field strength falls with the square of the distance from each pole) — a good picture outside the magnet.\nWires are long, straight and go straight through the screen: ⊙ means current coming out towards you, ⊗ going in. The field circles the wire (right-hand grip rule) and weakens with distance (B = μ₀I ÷ 2πr).\nField lines go from N to S outside a magnet and never cross; where they bunch up the field is stronger. The compass’s red end points along the field. Earth’s own field is left out.',
  mount({ stage, panel, api }) {
    let view = 'lines';
    const mags = [{ x: 0, y: 0, a: 0 }], wires = [], compass = { x: 0, y: 0 };
    let placed = false, W = 1, H = 1;
    const ML = 110, MW = 28;
    function poles(m) { const dx = Math.cos(m.a) * ML / 2, dy = Math.sin(m.a) * ML / 2; return [{ x: m.x + dx, y: m.y + dy, q: 1 }, { x: m.x - dx, y: m.y - dy, q: -1 }]; } // N at the +x end
    // the field at a point on the screen (screen y grows downwards)
    function B(x, y) {
      let bx = 0, by = 0;
      // each pole: straight out from N, straight into S, weakening with distance²
      for (const m of mags) for (const p of poles(m)) { const dx = x - p.x, dy = y - p.y, r2 = dx * dx + dy * dy + 30, r3 = r2 * Math.sqrt(r2); bx += (p.q * 4000 * dx) / r3; by += (p.q * 4000 * dy) / r3; }
      // each wire: round in circles, weakening with distance; ⊙ (current towards you) goes anticlockwise
      for (const w of wires) { const dx = x - w.x, dy = y - w.y, r2 = dx * dx + dy * dy + 40; bx += (w.I * 1.2 * dy) / r2; by += (-w.I * 1.2 * dx) / r2; }
      return [bx, by];
    }
    function trace(x, y, dir, stopAt) {
      const pts = [[x, y]];
      for (let i = 0; i < 700; i++) {
        const [bx, by] = B(x, y), m = Math.hypot(bx, by); if (m < 1e-9) break;
        // midpoint step
        const hx = x + (dir * 2 * bx) / m, hy = y + (dir * 2 * by) / m, [cx2, cy2] = B(hx, hy), m2 = Math.hypot(cx2, cy2) || 1;
        x += (dir * 4 * cx2) / m2; y += (dir * 4 * cy2) / m2;
        pts.push([x, y]);
        if (x < -20 || y < -20 || x > W + 20 || y > H + 20) break;
        if (stopAt && stopAt(x, y, i)) break;
      }
      return pts;
    }
    const cv = canvas(stage, (ctx, w, h) => {
      W = w; H = h;
      if (!placed) { mags[0].x = w * 0.42; mags[0].y = h * 0.5; compass.x = w * 0.75; compass.y = h * 0.3; placed = true; }
      if (view !== 'lines') {
        for (let x = 18; x < w; x += 34) for (let y = 18; y < h; y += 34) {
          const [bx, by] = B(x, y), m = Math.hypot(bx, by); if (m < 1e-6) continue;
          const a = Math.min(1, 0.15 + Math.log10(1 + m * 400) * 0.35);
          arrow(ctx, x - (bx / m) * 9, y - (by / m) * 9, x + (bx / m) * 9, y + (by / m) * 9, `rgba(242,242,244,${a})`, 1.2);
        }
      }
      if (view !== 'arrows') {
        ctx.lineWidth = 1.3;
        const allS = mags.flatMap((m) => poles(m).filter((p) => p.q < 0));
        for (const m of mags) {
          const n = poles(m)[0];
          for (let k = 0; k < 14; k++) {
            const a = (k / 14) * Math.PI * 2, pts = trace(n.x + Math.cos(a) * 8, n.y + Math.sin(a) * 8, 1, (x, y) => allS.some((s) => Math.hypot(x - s.x, y - s.y) < 8));
            line(ctx, pts, 'rgba(127,178,255,.55)', 1.3);
          }
        }
        for (const wi of wires) for (const r of [26, 52, 90, 140]) {
          const sx = wi.x + r, sy = wi.y;
          const pts = trace(sx, sy, 1, (x, y, i) => i > 20 && Math.hypot(x - sx, y - sy) < 5);
          line(ctx, pts, 'rgba(255,207,90,.5)', 1.3);
        }
      }
      // the magnets
      for (const m of mags) {
        ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.a);
        ctx.fillStyle = '#d64545'; ctx.fillRect(0, -MW / 2, ML / 2, MW);
        ctx.fillStyle = '#4a74d6'; ctx.fillRect(-ML / 2, -MW / 2, ML / 2, MW);
        ctx.fillStyle = '#fff'; ctx.font = '700 14px -apple-system, Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('N', ML / 2 - 14, 1); ctx.fillText('S', -ML / 2 + 14, 1);
        ctx.restore();
      }
      ctx.font = '600 12px -apple-system, Segoe UI, sans-serif';
      for (const wi of wires) {
        dot(ctx, wi.x, wi.y, 14, '#c9c6bd'); ctx.strokeStyle = '#16171c'; ctx.lineWidth = 2;
        if (wi.I > 0) dot(ctx, wi.x, wi.y, 4, '#16171c');
        else { ctx.beginPath(); ctx.moveTo(wi.x - 6, wi.y - 6); ctx.lineTo(wi.x + 6, wi.y + 6); ctx.moveTo(wi.x + 6, wi.y - 6); ctx.lineTo(wi.x - 6, wi.y + 6); ctx.stroke(); }
      }
      // the compass: red end points along the field
      const [bx, by] = B(compass.x, compass.y), m = Math.hypot(bx, by) || 1, ux = bx / m, uy = by / m;
      dot(ctx, compass.x, compass.y, 22, 'rgba(16,17,22,.9)'); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(compass.x, compass.y, 22, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#e04848'; ctx.beginPath(); ctx.moveTo(compass.x + ux * 17, compass.y + uy * 17); ctx.lineTo(compass.x - uy * 5, compass.y + ux * 5); ctx.lineTo(compass.x + uy * 5, compass.y - ux * 5); ctx.fill();
      ctx.fillStyle = '#e8e6df'; ctx.beginPath(); ctx.moveTo(compass.x - ux * 17, compass.y - uy * 17); ctx.lineTo(compass.x - uy * 5, compass.y + ux * 5); ctx.lineTo(compass.x + uy * 5, compass.y - ux * 5); ctx.fill();
    });
    // drag things; a tap (no drag) turns a magnet or flips a wire's current
    let held = null, moved = false, start = null;
    const inMagnet = (m, p) => { const dx = p.x - m.x, dy = p.y - m.y, u = dx * Math.cos(m.a) + dy * Math.sin(m.a), v = -dx * Math.sin(m.a) + dy * Math.cos(m.a); return Math.abs(u) < ML / 2 + 4 && Math.abs(v) < MW / 2 + 6; };
    drag(cv.c, {
      down(p) {
        moved = false; start = p;
        if (Math.hypot(p.x - compass.x, p.y - compass.y) < 26) held = compass;
        else held = wires.find((w) => Math.hypot(p.x - w.x, p.y - w.y) < 18) || mags.slice().reverse().find((m) => inMagnet(m, p)) || null;
        if (!held) return false;
      },
      move(p) { if (!held) return; if (Math.hypot(p.x - start.x, p.y - start.y) > 4) moved = true; if (moved) { held.x = Math.max(10, Math.min(W - 10, p.x)); held.y = Math.max(10, Math.min(H - 10, p.y)); report(); } },
      up() {
        if (held && !moved) { if (held.I) held.I = -held.I; else if (held !== compass) held.a = (held.a + Math.PI / 4) % (Math.PI * 2); report(); }
        held = null;
      },
    });
    const ov = overlay(stage, 'tl');
    button(ov, '+ Magnet', () => { if (mags.length < 4) { mags.push({ x: W * (0.3 + 0.15 * mags.length), y: H * 0.7, a: 0 }); report(); } });
    button(ov, '+ Wire', () => { if (wires.length < 4) { wires.push({ x: W * (0.25 + 0.17 * wires.length), y: H * 0.25, I: 1 }); report(); } });
    button(ov, 'Clear', () => { mags.length = 0; wires.length = 0; report(); });
    seg(group(panel, 'Show'), { options: [['lines', 'Field lines'], ['arrows', 'Arrows'], ['both', 'Both']], value: view, onChange: (v) => { view = v; cv.redraw(); } });
    panel.appendChild(el('p', 'lab-note', 'Drag magnets, wires and the compass. Tap a magnet to turn it 45°. Tap a wire to flip its current: ⊙ comes out of the screen, ⊗ goes in.'));
    const st = stats(panel);
    function report() {
      const [bx, by] = B(compass.x, compass.y), deg = Math.round((Math.atan2(-by, bx) * 180) / Math.PI);
      st.set([['Magnets', String(mags.length)], ['Wires', wires.map((w) => (w.I > 0 ? '⊙ out' : '⊗ in')).join(', ') || 'none'], ['Compass points', `${(deg + 360) % 360}° (0° = right, 90° = up)`]]);
      for (const a of mags) for (const b of mags) if (a !== b) { const na = poles(a)[0], sb = poles(b)[1]; if (Math.hypot(na.x - sb.x, na.y - sb.y) < 70) api.check(0); }
      if (wires.some((a) => wires.some((b) => a !== b && a.I === -b.I))) api.check(1);
      if (wires.some((w) => Math.hypot(w.x - compass.x, w.y - compass.y) < 90)) api.check(2);
      cv.redraw();
    }
    report();
    return { state: () => `${mags.length} bar magnet(s) and ${wires.length} wire(s) (${wires.map((w) => (w.I > 0 ? 'current out of the screen' : 'current into the screen')).join(', ') || 'no wires'}); the compass needle points ${(Math.round((Math.atan2(-B(compass.x, compass.y)[1], B(compass.x, compass.y)[0]) * 180) / Math.PI) + 360) % 360}° (0° = right)`, destroy: () => cv.destroy() };
  },
};

/* ---------------- Lenses and mirrors ---------------- */
const KINDS = { convex: ['Convex lens', 1, false], concave: ['Concave lens', -1, false], cmirror: ['Concave mirror', 1, true], vmirror: ['Convex mirror', -1, true] };
const opticsLab = {
  id: 'optics', name: 'Lenses & mirrors', subject: 'physics', topic: 'lenses and curved mirrors: ray diagrams, focal length, real and virtual images, magnification',
  blurb: 'Drag the object along the bench. Three rays find the image: real or virtual, upright or upside down.',
  words: 'lens mirror optics ray diagram focal length image real virtual magnification convex concave',
  icon: '<path d="M4 26h40"/><path d="M24 8c4 6 4 30 0 36M24 8c-4 6-4 30 0 36"/><path d="M8 26V14M8 14l-2 3M8 14l2 3"/><path d="M8 14l16 4 14 14" stroke-dasharray="3 3"/>',
  tries: ['Make a real image exactly the same size as the object', 'Make a magnifying glass: a bigger, upright image', 'Try a convex mirror — can it ever make a real image?'],
  hints: ['Use the convex lens and put the object at 2F (twice the focal length from the lens).', 'Use the convex lens and put the object closer to the lens than F.', 'Choose “Convex mirror” and drag the object both close to and far from the mirror. Watch the image.'],
  about: 'Uses the thin-lens and mirror equation 1/f = 1/u + 1/v with the “real is positive” convention: distances to real objects and real images are positive, to virtual images negative; f is negative for a concave (diverging) lens and a convex mirror. Magnification m = −v ÷ u (negative means upside down).\nRays are drawn for an ideal thin lens or mirror close to the axis (paraxial rays), using the three principal rays. Real lenses and mirrors blur a little (aberrations), which is left out.\nFor mirrors the reflected light comes back to the left, so a real image forms in front of the mirror and a virtual one appears behind it.',
  mount({ stage, panel, api }) {
    let kind = 'convex', f = 15, u = 40, ho = 5;
    const seenV = new Set();
    const calc = () => {
      const F = KINDS[kind][1] * f;
      if (Math.abs(u - F) < 1e-6) return { F, v: Infinity, m: Infinity };
      const v = 1 / (1 / F - 1 / u);
      return { F, v, m: -v / u };
    };
    let geom = null;
    const cv = canvas(stage, (ctx, w, h) => {
      const k = calc(), mirror = KINDS[kind][2], ax = h * 0.56, ox = mirror ? w * 0.64 : w * 0.5;
      const s = Math.min((ox - 24) / 62, (h * 0.42) / 12);
      const X = (x) => ox + x * s, Y = (y) => ax - y * s;
      geom = { X, Y, s, ox, ax };
      line(ctx, [[0, ax], [w, ax]], DIM, 1);
      // F and 2F marks (C for mirrors)
      const marks = mirror ? [[-k.F, 'F'], [-2 * k.F, 'C']] : [[k.F, 'F'], [-k.F, 'F'], [2 * k.F, '2F'], [-2 * k.F, '2F']];
      marks.forEach(([x, n]) => { if (X(x) > 4 && X(x) < w - 4) { dot(ctx, X(x), ax, 3.5, INK); text(ctx, n, X(x), ax + 18, DIM, 'center'); } });
      // the lens or mirror
      const hh = h * 0.36;
      if (mirror) {
        const bulge = kind === 'cmirror' ? 10 : -10;
        ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ox + bulge, ax - hh); ctx.quadraticCurveTo(ox - bulge, ax, ox + bulge, ax + hh); ctx.stroke();
        for (let y = -hh; y < hh; y += 12) line(ctx, [[ox + bulge * (1 - (2 * Math.abs(y)) / hh) * -1 + bulge + 2, ax + y], [ox + bulge + 12, ax + y + 8]], FAINT, 1);
      } else {
        const t = kind === 'convex' ? 12 : -9;
        ctx.fillStyle = 'rgba(127,178,255,.18)'; ctx.strokeStyle = 'rgba(127,178,255,.8)'; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(ox - (kind === 'convex' ? 0 : 10), ax - hh); ctx.quadraticCurveTo(ox + t * 2, ax, ox - (kind === 'convex' ? 0 : 10), ax + hh);
        ctx.lineTo(ox + (kind === 'convex' ? 0 : 10), ax + hh); ctx.quadraticCurveTo(ox - t * 2, ax, ox + (kind === 'convex' ? 0 : 10), ax - hh); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      // the object: an upright arrow
      arrow(ctx, X(-u), ax, X(-u), Y(ho), C.gold, 3);
      // three principal rays from the object's tip, each heading to the image (or away from a virtual one)
      const hi = k.m * ho, real = k.v > 0 && Number.isFinite(k.v);
      const ix = mirror ? -k.v : k.v; // where the image is, along the bench
      const hits = [ho, 0, Number.isFinite(k.v) ? (-k.F * ho) / (u - k.F) : ho * 0];
      hits.forEach((yl, i) => {
        if (!Number.isFinite(k.v) && i === 2) return; // (at F that ray never reaches the lens)
        const col = ['rgba(255,122,122,.9)', 'rgba(127,224,168,.9)', 'rgba(196,160,255,.9)'][i];
        line(ctx, [[X(-u), Y(ho)], [X(0), Y(yl)]], col, 1.6);
        let dx, dy;
        if (!Number.isFinite(k.v)) { dx = mirror ? -k.F : k.F; dy = -ho; } // object at F: every ray leaves parallel
        else if (real) { dx = ix - 0; dy = hi - yl; }
        else { dx = 0 - ix; dy = yl - hi; }
        const len = 400 / Math.max(1e-6, Math.hypot(dx, dy));
        line(ctx, [[X(0), Y(yl)], [X(0 + dx * len), Y(yl + dy * len)]], col, 1.6);
        if (!real && Number.isFinite(k.v)) { ctx.setLineDash([4, 4]); line(ctx, [[X(0), Y(yl)], [X(ix), Y(hi)]], col.replace('.9', '.45'), 1.2); ctx.setLineDash([]); }
      });
      if (Number.isFinite(k.v) && Math.abs(hi) < 60) { if (!real) ctx.setLineDash([5, 4]); arrow(ctx, X(ix), ax, X(ix), Y(hi), C.blue, 3); ctx.setLineDash([]); text(ctx, real ? 'image (real)' : 'image (virtual)', X(ix), Y(hi) + (hi > 0 ? -10 : 18), C.blue, 'center'); }
      else text(ctx, Number.isFinite(k.v) ? 'The image is very far away' : 'At F: the rays come out parallel — no image forms', w / 2, 24, C.blue, 'center');
      text(ctx, 'object', X(-u), ax + 18, C.gold, 'center');
    });
    drag(cv.c, {
      down(p) { if (!geom) return false; move(p); },
      move,
    });
    function move(p) {
      const x = (p.x - geom.ox) / geom.s, y = (geom.ax - p.y) / geom.s;
      u = Math.round(Math.max(2, Math.min(60, -x)) * 2) / 2;
      if (Math.abs(p.y - geom.ax) > 20) ho = Math.round(Math.max(1, Math.min(10, y)) * 2) / 2;
      uS.set(u); report();
    }
    seg(group(panel, 'Use'), { options: Object.entries(KINDS).map(([k2, v]) => [k2, v[0]]), value: kind, onChange: (v) => { kind = v; report(); } });
    const g = group(panel, 'Bench');
    slider(g, { label: 'Focal length', min: 5, max: 30, step: 0.5, value: f, fmt: (x) => x + ' cm', onInput: (x) => { f = x; report(); } });
    const uS = slider(g, { label: 'Object distance', min: 2, max: 60, step: 0.5, value: u, fmt: (x) => x + ' cm', onInput: (x) => { u = x; report(); } });
    panel.appendChild(el('p', 'lab-note', 'Drag on the picture to move the object (and drag up or down to change its height).'));
    const st = stats(panel);
    function report() {
      const k = calc(), mirror = KINDS[kind][2];
      if (!Number.isFinite(k.v)) st.set([['Image', 'none — the object is at the focal point']]);
      else {
        const real = k.v > 0, side = mirror ? (real ? 'in front of the mirror' : 'behind the mirror') : (real ? 'on the far side of the lens' : 'on the same side as the object');
        st.set([['Object distance u', `${num(u)} cm`], ['Image distance v', `${num(Math.abs(k.v))} cm ${side}`], ['Magnification', `${num(k.m)} ×`], ['The image is', `${real ? 'real' : 'virtual'}, ${k.m < 0 ? 'upside down' : 'upright'}, ${Math.abs(Math.abs(k.m) - 1) < 0.02 ? 'the same size' : Math.abs(k.m) > 1 ? 'bigger' : 'smaller'}`]]);
        if (real && Math.abs(Math.abs(k.m) - 1) < 0.03) api.check(0);
        if (kind === 'convex' && !real && Math.abs(k.m) > 1) api.check(1);
        if (kind === 'vmirror') { seenV.add(u < f ? 'near' : 'far'); if (seenV.size === 2) api.check(2); }
      }
      cv.redraw();
    }
    report();
    return { state: () => { const k = calc(); return `a ${KINDS[kind][0].toLowerCase()} with focal length ${f} cm and the object ${u} cm away (${ho} cm tall): ${Number.isFinite(k.v) ? `the image is ${num(Math.abs(k.v))} cm away, ${k.v > 0 ? 'real' : 'virtual'}, magnification ${num(k.m)}` : 'no image forms (object at the focal point)'}`; }, destroy: () => cv.destroy() };
  },
};

/* ---------------- Logic gates ---------------- */
const GATES = { AND: (a, b) => a & b, OR: (a, b) => a | b, NOT: (a) => 1 - a, NAND: (a, b) => 1 - (a & b), NOR: (a, b) => 1 - (a | b), XOR: (a, b) => a ^ b, XNOR: (a, b) => 1 - (a ^ b) };
// puzzles: switches → gates → lamps. Each gate: [type, inputA, inputB] (inputs: 'S0'… or 'G0'…). Lamps: [source, wanted]
const LEVELS = [
  { s: 2, g: [['AND', 'S0', 'S1']], l: [['G0', 1]] },
  { s: 2, g: [['NAND', 'S0', 'S1'], ['OR', 'S0', 'S1']], l: [['G0', 0], ['G1', 1]] },
  { s: 3, g: [['NOT', 'S1'], ['AND', 'S0', 'G0'], ['OR', 'S1', 'S2']], l: [['G1', 1], ['G2', 1]] },
  { s: 3, g: [['XOR', 'S0', 'S1'], ['XOR', 'S1', 'S2'], ['AND', 'S0', 'S2']], l: [['G0', 1], ['G1', 1], ['G2', 1]] },
  { s: 4, g: [['NOR', 'S0', 'S1'], ['XOR', 'S2', 'S3'], ['NOT', 'S3'], ['NAND', 'S2', 'G2']], l: [['G0', 1], ['G1', 1], ['G3', 0]] },
  { s: 4, g: [['XOR', 'S0', 'S1'], ['XOR', 'S2', 'S3'], ['AND', 'G0', 'G1'], ['AND', 'S0', 'S2'], ['AND', 'S1', 'S3'], ['OR', 'G3', 'G4'], ['NOT', 'S0']], l: [['G2', 1], ['G5', 0], ['G6', 0]] },
];
function runLevel(L, sw) {
  const val = {};
  sw.forEach((v, i) => { val['S' + i] = v; });
  L.g.forEach(([t, a, b], i) => { val['G' + i] = GATES[t](val[a], b ? val[b] : 0); });
  return val;
}
function fewest(L) { // fewest switch flips from all-off to a solution
  let best = Infinity;
  for (let m = 0; m < 1 << L.s; m++) {
    const sw = Array.from({ length: L.s }, (_, i) => (m >> i) & 1), v = runLevel(L, sw);
    if (L.l.every(([src, want]) => v[src] === want)) best = Math.min(best, sw.reduce((a, b) => a + b, 0));
  }
  return best;
}
function drawGate(ctx, type, x, y, s, on) {
  ctx.lineWidth = 2; ctx.strokeStyle = on ? C.gold : INK; ctx.fillStyle = 'rgba(16,17,22,.95)';
  const w = s * 1.4, h = s, bubble = /^N|XNOR/.test(type) && type !== 'NOT' ? true : type === 'NOT';
  const base = type.replace(/^N(?!OT)/, '').replace('XNOR', 'XOR');
  ctx.beginPath();
  if (base === 'AND') { ctx.moveTo(x, y - h / 2); ctx.lineTo(x + w * 0.5, y - h / 2); ctx.arc(x + w * 0.5, y, h / 2, -Math.PI / 2, Math.PI / 2); ctx.lineTo(x, y + h / 2); ctx.closePath(); }
  else if (base === 'NOT') { ctx.moveTo(x, y - h / 2); ctx.lineTo(x + w * 0.8, y); ctx.lineTo(x, y + h / 2); ctx.closePath(); }
  else { ctx.moveTo(x, y - h / 2); ctx.quadraticCurveTo(x + w * 0.6, y - h / 2, x + w, y); ctx.quadraticCurveTo(x + w * 0.6, y + h / 2, x, y + h / 2); ctx.quadraticCurveTo(x + w * 0.25, y, x, y - h / 2); }
  ctx.fill(); ctx.stroke();
  if (base === 'XOR') { ctx.beginPath(); ctx.moveTo(x - 7, y - h / 2); ctx.quadraticCurveTo(x + w * 0.25 - 7, y, x - 7, y + h / 2); ctx.stroke(); }
  const outX = base === 'NOT' ? x + w * 0.8 : x + w;
  if (bubble) { ctx.beginPath(); ctx.arc(outX + 5, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  text(ctx, type, x + w * 0.38, y + 4, on ? C.gold : DIM, 'center');
  return outX + (bubble ? 10 : 0);
}
const logicLab = {
  id: 'logic', name: 'Logic gates', subject: 'physics', topic: 'logic gates (AND, OR, NOT, NAND, NOR, XOR) and truth tables',
  blurb: 'Flip switches into AND, OR, NOT and friends — then solve circuit puzzles in as few moves as you can.',
  words: 'logic gates and or not nand nor xor truth table boolean circuit digital electronics computer science',
  icon: '<path d="M8 14h8M8 34h8M16 8h10a16 16 0 0 1 0 32H16z"/><path d="M42 24h-6"/>',
  tries: ['Find the inputs that make NAND output 0', 'Solve puzzle 3', 'Solve all 6 puzzles'],
  hints: ['Pick NAND. It is “NOT AND”: its output is 0 only when the AND would be 1.', 'Lamp 1 needs A on and B off (B goes through a NOT). Lamp 2 needs B or C on.', 'Work backwards from each lamp: what must its gate’s inputs be? Fewest moves = fewest switches you need on.'],
  about: 'A gate’s output is 1 (on) or 0 (off) depending only on its inputs: AND needs both inputs on, OR needs at least one, NOT flips its input, XOR needs exactly one. NAND, NOR and XNOR are AND, OR and XOR followed by NOT (the little circle on the symbol).\nThe symbols are the standard (ANSI/IEEE) shapes used in most textbooks. Every computer chip is built from millions of gates like these — NAND alone can build all the others.',
  mount({ stage, panel, api }) {
    let mode = 'gates', type = 'AND', A = 0, Bv = 0, lvl = 0, sw = [], moves = 0;
    const solved = new Set(JSON.parse((() => { try { return localStorage.getItem('cassie.logic') || '[]'; } catch (e) { return '[]'; } })()));
    const startLevel = (i) => { lvl = i; sw = Array(LEVELS[i].s).fill(0); moves = 0; };
    startLevel(0);
    let hit = [];
    const cv = canvas(stage, (ctx, w, h) => {
      hit = [];
      const sw2 = (x, y, on, label, key) => {
        ctx.fillStyle = on ? C.gold : 'rgba(255,255,255,.1)'; ctx.beginPath(); ctx.roundRect(x - 22, y - 14, 44, 28, 14); ctx.fill();
        dot(ctx, on ? x + 8 : x - 8, y, 10, on ? '#16171c' : INK);
        text(ctx, label, x - 30, y + 4, INK, 'right');
        hit.push({ x, y, key });
      };
      const lamp = (x, y, on, want) => {
        if (on) { const g = ctx.createRadialGradient(x, y, 0, x, y, 30); g.addColorStop(0, 'rgba(255,207,90,.6)'); g.addColorStop(1, 'rgba(255,207,90,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.fill(); }
        dot(ctx, x, y, 13, on ? C.gold : '#3a3b42');
        if (want != null) { text(ctx, `wants ${want ? 'ON' : 'OFF'}`, x + 20, y + 4, (on ? 1 : 0) === want ? C.green : C.red); }
      };
      const wire = (x1, y1, x2, y2, on) => { ctx.strokeStyle = on ? C.gold : 'rgba(242,242,244,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.bezierCurveTo((x1 + x2) / 2, y1, (x1 + x2) / 2, y2, x2, y2); ctx.stroke(); };
      if (mode === 'gates') {
        const s = Math.min(90, h / 3, w / 6), gx = w / 2 - s * 0.4, gy = h / 2, out = GATES[type](A, Bv);
        const ins = type === 'NOT' ? [[A, gy]] : [[A, gy - s * 0.28], [Bv, gy + s * 0.28]];
        ins.forEach(([v, y], i) => { wire(gx - s * 1.4, i ? gy + s * 0.9 : (type === 'NOT' ? gy : gy - s * 0.9), gx, y, v); sw2(gx - s * 1.4 - 24, i ? gy + s * 0.9 : (type === 'NOT' ? gy : gy - s * 0.9), v, i ? 'B' : 'A', i ? 'B' : 'A'); });
        const ox = drawGate(ctx, type, gx, gy, s, out);
        wire(ox, gy, ox + s, gy, out); lamp(ox + s + 14, gy, out);
        text(ctx, `output ${out}`, ox + s + 14, gy + 34, out ? C.gold : DIM, 'center');
        text(ctx, 'Tap a switch to flip it', w / 2, h - 14, DIM, 'center');
        return;
      }
      const L = LEVELS[lvl], v = runLevel(L, sw);
      // columns: switches, then gates in order of depth, then lamps
      const depth = {}; L.g.forEach(([, a, b], i) => { depth['G' + i] = 1 + Math.max(...[a, b].filter(Boolean).map((x) => (x[0] === 'S' ? 0 : depth[x]))); });
      const maxD = Math.max(...Object.values(depth)), colW = (w - 160) / (maxD + 1), pos = {};
      L.g.forEach((_, i) => { const d = depth['G' + i], same = L.g.map((__, j) => j).filter((j) => depth['G' + j] === d), k = same.indexOf(i); pos['G' + i] = [70 + d * colW, (h * (k + 1)) / (same.length + 1)]; });
      for (let i = 0; i < L.s; i++) pos['S' + i] = [60, (h * (i + 1)) / (L.s + 1)];
      const s = Math.min(54, colW * 0.45, h / (L.g.length + 2));
      L.g.forEach(([t, a, b], i) => {
        const [x, y] = pos['G' + i];
        [a, b].filter(Boolean).forEach((src, k) => { const [sx, sy] = pos[src], tx = x - s * 0.7, ty = t === 'NOT' ? y : y + (k ? 1 : -1) * s * 0.28; wire(src[0] === 'S' ? sx + 22 : sx + s * 0.75, sy, tx, ty, v[src]); });
      });
      L.g.forEach(([t], i) => { const [x, y] = pos['G' + i]; pos['G' + i].out = drawGate(ctx, t, x - s * 0.7, y, s, v['G' + i]); });
      L.l.forEach(([src, want], k) => { const [x, y] = pos[src], lx = w - 110, ly = (h * (k + 1)) / (L.l.length + 1); wire(pos[src].out, y, lx - 14, ly, v[src]); lamp(lx, ly, v[src], want); });
      for (let i = 0; i < L.s; i++) sw2(pos['S' + i][0], pos['S' + i][1], sw[i], 'ABCD'[i], 'S' + i);
      const done = L.l.every(([src, want]) => v[src] === want);
      text(ctx, done ? `Solved in ${moves} move${moves === 1 ? '' : 's'}${moves === fewest(L) ? ' — the fewest possible!' : ` (fewest: ${fewest(L)})`}` : `Puzzle ${lvl + 1} of ${LEVELS.length} · moves ${moves}`, w / 2, 22, done ? C.green : INK, 'center');
    });
    cv.c.addEventListener('click', (e) => {
      const p = at(cv.c, e), hh = hit.find((q) => Math.abs(p.x - q.x) < 30 && Math.abs(p.y - q.y) < 22);
      if (!hh) return;
      if (hh.key === 'A') A = 1 - A; else if (hh.key === 'B') Bv = 1 - Bv;
      else { const i = +hh.key.slice(1); sw[i] = 1 - sw[i]; moves++; }
      report();
    });
    const modeS = seg(group(panel, 'Mode'), { options: [['gates', 'Try each gate'], ['puzzles', 'Circuit puzzles']], value: mode, onChange: (v) => { mode = v; build(); report(); } });
    void modeS;
    const box = el('div'); panel.appendChild(box);
    const tableEl = el('div', 'lab-truth'); panel.appendChild(tableEl);
    function build() {
      box.replaceChildren();
      if (mode === 'gates') seg(group(box, 'Gate'), { options: Object.keys(GATES).map((k) => [k, k]), value: type, onChange: (v) => { type = v; report(); } });
      else {
        const r1 = row(group(box, 'Puzzle'), 'lab-row-btns');
        LEVELS.forEach((_, i) => { const b = button(r1, `${i + 1}${solved.has(i) ? ' ✓' : ''}`, () => { startLevel(i); build(); report(); }); b.setAttribute('aria-pressed', String(i === lvl)); });
        button(row(box, 'lab-row-btns'), 'Start this puzzle again', () => { startLevel(lvl); report(); });
      }
    }
    function report() {
      if (mode === 'gates') {
        const rows = type === 'NOT' ? [[0], [1]] : [[0, 0], [0, 1], [1, 0], [1, 1]];
        tableEl.innerHTML = `<h4>Truth table: ${type}</h4><table><tr>${type === 'NOT' ? '<th>A</th>' : '<th>A</th><th>B</th>'}<th>Out</th></tr>${rows.map((r) => `<tr class="${r[0] === A && (type === 'NOT' || r[1] === Bv) ? 'on' : ''}">${r.map((x) => `<td>${x}</td>`).join('')}<td><b>${GATES[type](r[0], r[1] || 0)}</b></td></tr>`).join('')}</table>`;
        if (type === 'NAND' && GATES.NAND(A, Bv) === 0) api.check(0);
      } else {
        tableEl.innerHTML = '';
        const L = LEVELS[lvl], v = runLevel(L, sw);
        if (L.l.every(([src, want]) => v[src] === want)) {
          solved.add(lvl); try { localStorage.setItem('cassie.logic', JSON.stringify([...solved])); } catch (e) { /* ignore */ }
          if (lvl === 2) api.check(1);
          if (solved.size === LEVELS.length) api.check(2);
          build();
        }
      }
      cv.redraw();
    }
    build(); report();
    return {
      state: () => (mode === 'gates' ? `the ${type} gate with A = ${A}${type === 'NOT' ? '' : ` and B = ${Bv}`}: output ${GATES[type](A, Bv)}` : `circuit puzzle ${lvl + 1}: switches ${sw.map((x, i) => `${'ABCD'[i]} = ${x}`).join(', ')}; ${moves} moves so far`),
      destroy: () => cv.destroy(),
    };
  },
};

/* ---------------- Rocket ---------------- */
const ENGINES = { solid: ['Solid fuel', 260], kerosene: ['Kerosene + oxygen', 311], hydrogen: ['Hydrogen + oxygen', 450] };
const G0 = 9.80665, R_EARTH = 6371e3;
const rocketLab = {
  id: 'rocket', name: 'Rocket workshop', subject: 'physics', topic: 'rockets: thrust, weight, Newton’s laws, the rocket equation, staging and reaching orbit',
  blurb: 'Build a 3D rocket — engines, fuel, stages — and launch it from the pad. Can it lift off, reach space, or have enough Δv for orbit?',
  words: 'rocket launch thrust weight stages delta v orbit space newton tsiolkovsky fuel',
  icon: '<path d="M24 4c6 6 8 14 8 22v8H16v-8c0-8 2-16 8-22z"/><circle cx="24" cy="18" r="3"/><path d="M16 28l-6 8v4l6-4M32 28l6 8v4l-6-4M20 40l4 6 4-6"/>',
  three: true,
  tries: ['Lift off: the thrust must beat the weight', 'Reach space — 100 km up', 'Get enough Δv for orbit (about 9.4 km/s)'],
  hints: ['At the start this rocket is too heavy for its engine. Raise the thrust, or use less fuel.', 'More fuel burns for longer. Keep the thrust well above the weight (thrust ÷ weight above about 1.3).', 'One stage can’t carry its empty tanks all the way. Try 2 or 3 stages and the hydrogen engine.'],
  about: 'Newton’s second law each tenth of a second: acceleration = (thrust − weight − air drag) ÷ mass. Gravity weakens with height; air thins with height (density halves about every 6 km).\nThe rocket flies straight up, which is the quickest way to reach space (100 km, the Kármán line). Getting into orbit is much harder: it needs a sideways speed of about 7.8 km/s, so this checks the rocket’s total Δv from the rocket equation, Δv = Isp × g₀ × ln(full mass ÷ empty mass), against the ~9.4 km/s a real launch needs (including losses to gravity and air).\nAssumptions: each stage’s empty tanks and engines weigh 10% of its fuel; every engine uses its vacuum efficiency (Isp: solid 260 s, kerosene 311 s, hydrogen 450 s); upper stages get an engine strong enough to push 1.2 g.',
  mount({ stage, panel, api }) {
    let n = 1, eng = 'kerosene', fuel = [10, 3, 1], payload = 1, thrust = 100, flight = null, best = 0;
    // the rocket in 3D (where the browser can), with the height scale and graph drawn on top
    let R3 = null, dead = false, rebuildT = 0;
    const use3d = webglOk();
    if (use3d) import('./rocket3d.js').then((m) => m.rocketScene(stage)).then((r) => { if (dead) { r.destroy(); return; } R3 = r; R3.show(design(), eng); cv.c.parentNode.appendChild(cv.c); cv.redraw(); /* (the drawing stays on top) */ }).catch(() => { /* the flat drawing stays */ });
    const show3d = () => { if (!R3 || (flight && !flight.over)) return; clearTimeout(rebuildT); rebuildT = setTimeout(() => R3 && R3.show(design(), eng), 120); };
    function design() {
      const isp = ENGINES[eng][1], st = [];
      let above = payload * 1000;
      for (let i = n - 1; i >= 0; i--) { const f = fuel[i] * 1000, dry = 0.1 * f, m0 = above + f + dry; st.unshift({ f, dry, m0, mf: m0 - f }); above = m0; }
      st.forEach((s, i) => { s.T = i === 0 ? thrust * 1000 : 1.2 * G0 * s.m0; s.mdot = s.T / (isp * G0); });
      const dv = st.reduce((a, s) => a + isp * G0 * Math.log(s.m0 / s.mf), 0);
      return { st, dv, m0: st[0].m0, twr: st[0].T / (st[0].m0 * G0), isp };
    }
    function launch() {
      const D = design();
      flight = { D, t: 0, h: 0, v: 0, i: 0, fuelLeft: D.st[0].f, mass: D.st[0].m0, maxH: 0, maxV: 0, path: [[0, 0]], over: false, msg: '' };
      if (D.twr <= 1) { flight.over = true; flight.msg = `It can’t lift off: the thrust (${num(D.st[0].T / 1000)} kN) is less than the weight (${num((D.m0 * G0) / 1000)} kN).`; report(); return; }
      api.check(0);
      if (R3) R3.show(D, eng);
      tick.start();
    }
    function step(dt) {
      const F = flight, s = F.D.st[F.i];
      const g = G0 * (R_EARTH / (R_EARTH + F.h)) ** 2, rho = 1.225 * Math.exp(-F.h / 8500), drag = 0.5 * rho * F.v * Math.abs(F.v) * 0.5 * 10;
      let T = 0;
      if (s && F.fuelLeft > 0) { T = s.T; const burn = Math.min(F.fuelLeft, s.mdot * dt); F.fuelLeft -= burn; F.mass -= burn; }
      else if (s && F.i < F.D.st.length - 1) { F.i++; F.mass = F.D.st[F.i].m0; F.fuelLeft = F.D.st[F.i].f; F.msg = `Stage ${F.i} dropped — stage ${F.i + 1} fires`; }
      F.v += (T / F.mass - g - drag / F.mass) * dt;
      F.h = Math.max(0, F.h + F.v * dt); F.t += dt;
      F.maxH = Math.max(F.maxH, F.h); F.maxV = Math.max(F.maxV, F.v);
      if (F.h <= 0 && F.t > 2 && F.v <= 0) F.over = true;
    }
    const tick = clock((dt) => {
      if (!flight || flight.over) return false;
      const speedUp = flight.h > 100e3 ? 60 : flight.h > 10e3 ? 20 : 6;
      for (let k = 0; k < Math.round((dt * speedUp) / 0.1); k++) { step(0.1); if (flight.over) break; }
      if (flight.path.length < 4000) flight.path.push([flight.t, flight.h]);
      if (R3) R3.fly({ h: flight.h, v: flight.v, stage: flight.i, burning: flight.fuelLeft > 0 && !flight.over, D: flight.D, eng });
      if (flight.maxH >= 100e3) api.check(1);
      if (flight.over || flight.t > 4000) { flight.over = true; best = Math.max(best, flight.maxH); report(); return false; }
      report(true);
      return true;
    });
    const altY = (hm, top, bottom) => bottom - ((bottom - top) * Math.log10(1 + hm / 100)) / Math.log10(1 + 2e6 / 100);
    const cv = canvas(stage, (ctx, w, h) => {
      const top = 30, bottom = h - 40, sx = 70;
      // the height scale (stretched so the ground and space both fit)
      line(ctx, [[sx, top], [sx, bottom]], DIM, 1);
      [[0, 'ground'], [1e3, '1 km'], [10e3, '10 km (airliners)'], [100e3, '100 km — space'], [400e3, '400 km (space station)'], [2e6, '2,000 km']].forEach(([hm, lab]) => {
        const y = altY(hm, top, bottom); line(ctx, [[sx - 5, y], [sx + 5, y]], hm === 100e3 ? C.gold : DIM, hm === 100e3 ? 2 : 1); text(ctx, lab, sx + 10, y + 4, hm === 100e3 ? C.gold : DIM);
        if (hm === 100e3) { ctx.setLineDash([4, 6]); line(ctx, [[sx, y], [w, y]], 'rgba(255,207,90,.3)', 1); ctx.setLineDash([]); }
      });
      const F = flight, hm = F ? F.h : 0, y = altY(hm, top, bottom), rx = w * 0.42;
      if (R3) { // in 3D: just a marker on the height scale, and the height in big numbers
        dot(ctx, sx, y, 6, C.gold);
        ctx.font = '700 22px -apple-system, Segoe UI, sans-serif'; text(ctx, F ? (F.h >= 1000 ? `${num(F.h / 1000)} km` : `${Math.round(F.h)} m`) : 'On the pad', w / 2, 34, '#fff', 'center');
        ctx.font = '600 13px -apple-system, Segoe UI, sans-serif'; if (F) text(ctx, `${num(Math.abs(F.v))} m/s ${F.v < -1 ? 'falling' : 'up'}`, w / 2, 54, 'rgba(255,255,255,.8)', 'center');
      } else {
      // the rocket
      ctx.save(); ctx.translate(rx, y - 50); ctx.scale(1.8, 1.8);
      const stagesLeft = F ? F.D.st.length - F.i : n;
      for (let k = 0; k < stagesLeft; k++) { ctx.fillStyle = k % 2 ? '#c9c6bd' : '#e8e6df'; ctx.fillRect(-8, -k * 18, 16, 18); }
      ctx.fillStyle = '#e8e6df'; ctx.beginPath(); ctx.moveTo(-8, -stagesLeft * 18); ctx.lineTo(0, -stagesLeft * 18 - 16); ctx.lineTo(8, -stagesLeft * 18); ctx.fill();
      if (F && !F.over && F.fuelLeft > 0) { ctx.fillStyle = 'rgba(255,170,60,.9)'; ctx.beginPath(); ctx.moveTo(-6, 18); ctx.lineTo(0, 18 + 18 + Math.random() * 10); ctx.lineTo(6, 18); ctx.fill(); }
      ctx.restore();
      }
      // height against time
      if (F && F.path.length > 1 && w > 560) {
        const gx = w * 0.58, gy = 40, gw = w * 0.38, gh = h * 0.45, tMax = Math.max(60, F.t), hMax = Math.max(1000, F.maxH);
        if (R3) { ctx.fillStyle = 'rgba(10,11,16,.55)'; ctx.beginPath(); ctx.roundRect(gx - 12, gy - 26, gw + 24, gh + 50, 12); ctx.fill(); }
        ctx.strokeStyle = GRID; ctx.strokeRect(gx, gy, gw, gh);
        line(ctx, F.path.map(([t, hh]) => [gx + (t / tMax) * gw, gy + gh - (hh / hMax) * gh]), C.gold, 2);
        text(ctx, `height (max ${num(hMax / 1000)} km)`, gx, gy - 8, DIM); text(ctx, `time (${num(tMax)} s)`, gx + gw, gy + gh + 16, DIM, 'right');
      }
      if (F && F.msg) text(ctx, F.msg, w / 2, h - 14, F.over && F.maxH === 0 ? C.red : INK, 'center');
    });
    cv.c.classList.add('lab-hud');
    const ov = overlay(stage, 'br');
    button(ov, '▶ Launch', () => { if (!flight || flight.over) launch(); }, 'main big');
    if (use3d) button(ov, 'Zoom out', () => R3 && R3.zoomOut());
    if (use3d) stage.appendChild(el('p', 'lab-hint-3d', 'Drag to look around the rocket · pinch or scroll to zoom'));
    seg(group(panel, 'Stages'), { options: [[1, '1'], [2, '2'], [3, '3']], value: n, onChange: (v) => { n = v; build(); report(); } });
    seg(group(panel, 'Engines'), { options: Object.entries(ENGINES).map(([k, [nm, isp]]) => [k, `${nm} (Isp ${isp} s)`]), value: eng, onChange: (v) => { eng = v; report(); } });
    const box = el('div'); panel.appendChild(box);
    function build() {
      box.replaceChildren();
      const g = group(box, 'Build');
      slider(g, { label: 'First-stage thrust', min: 20, max: 8000, step: 10, value: thrust, fmt: (x) => `${x.toLocaleString()} kN`, onInput: (x) => { thrust = x; report(); } });
      for (let i = 0; i < n; i++) slider(g, { label: `Stage ${i + 1} fuel`, min: 0.5, max: i ? 150 : 500, step: 0.5, value: fuel[i], fmt: (x) => x + ' t', onInput: (x) => { fuel[i] = x; report(); } });
      slider(g, { label: 'Payload (what you’re sending up)', min: 0.1, max: 30, step: 0.1, value: payload, fmt: (x) => x + ' t', onInput: (x) => { payload = x; report(); } });
    }
    const st = stats(panel);
    let shown = 0;
    function report(soft) {
      const now = performance.now(); if (soft && now - shown < 200) { cv.redraw(); return; } shown = now;
      const D = design();
      const list = [['Mass at lift-off', `${num(D.m0 / 1000)} t`], ['Thrust ÷ weight', `${num(D.twr)}${D.twr <= 1 ? ' — too heavy to lift off' : ''}`], ['Total Δv', `${num(D.dv / 1000)} km/s${D.dv >= 9400 ? ' — enough for orbit' : ` (orbit needs about 9.4)`}`]];
      if (flight) list.push(['Height now', `${num(flight.h / 1000)} km`], ['Speed now', `${num(flight.v)} m/s`], ['Highest so far', `${num(flight.maxH / 1000)} km`]);
      st.set(list);
      if (D.dv >= 9400) api.check(2);
      if (!soft) show3d();
      cv.redraw();
    }
    build(); report();
    return {
      state: () => { const D = design(); return `a ${n}-stage rocket with ${ENGINES[eng][0].toLowerCase()} engines, lift-off mass ${num(D.m0 / 1000)} t, thrust ÷ weight ${num(D.twr)}, total Δv ${num(D.dv / 1000)} km/s${flight ? `; the last launch reached ${num(flight.maxH / 1000)} km` : ''}`; },
      destroy: () => { dead = true; tick.stop(); cv.destroy(); if (R3) R3.destroy(); },
    };
  },
};

export const PHYSICS2 = [colourLab, magnetLab, opticsLab, logicLab, rocketLab];

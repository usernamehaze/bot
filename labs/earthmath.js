/* Earth, maths and geography labs (v229): day and night as the Earth spins, tectonic plates and earthquake
   waves, the unit circle and sine waves, and reading topographic contour maps. */
import { INK, DIM, FAINT, C, el, num, canvas, drag, clock, group, slider, seg, button, row, stats, line, dot, text, arrow } from './kit.js';

const calm = () => document.documentElement.classList.contains('lite') || !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const TAU = Math.PI * 2;

/* ---------------- Day and night ---------------- */
// one place on the Equator, seen from above the North Pole with the Sun to the left. The Earth spins
// anticlockwise (west to east) once in 24 hours, so a place faces the Sun at noon and faces away at midnight.
export const isDay = (h) => { const x = ((h % 24) + 24) % 24; return x > 6 && x < 18; };
export const clockOf = (h) => { const t = ((Math.round(h * 60) % 1440) + 1440) % 1440, hh = Math.floor(t / 60), mm = t % 60; return `${(hh % 12) || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`; };
export const partOf = (h) => { const x = ((h % 24) + 24) % 24; return x < 5 || x >= 19.5 ? 'Night' : x < 7 ? (x < 6 ? 'Just before sunrise' : 'Sunrise') : x < 12 ? 'Morning' : x < 13 ? 'Noon' : x < 18 ? 'Afternoon' : 'Sunset'; };
const dayNightLab = {
  id: 'daynight', name: 'Day and night', subject: 'space', levels: ['elem'], topic: 'day and night: the Earth spinning on its axis, sunrise and sunset',
  blurb: 'Spin the Earth in front of the Sun and see why it is day for you and night on the other side of the world.',
  words: 'day night earth rotation spin axis sun sunrise sunset time zones 24 hours morning evening',
  icon: '<circle cx="10" cy="24" r="5"/><circle cx="32" cy="24" r="11"/><path d="M32 13a11 11 0 0 1 0 22z"/>',
  tries: ['Make it night where you live', 'Find sunrise: the moment you turn into the sunlight', 'Spin the Earth for one whole day'],
  hints: ['Spin until you are on the side facing away from the Sun.', 'Sunrise is at about 6 am. Slide the time until you are just crossing from the dark side into the light.', 'Press “Spin for a day” and watch the Earth turn all the way round once.'],
  about: 'The Earth spins on its axis once every 24 hours, from west to east. The half facing the Sun has day; the half facing away has night.\nAs a place turns into the sunlight it has sunrise, and as it turns out of it, sunset. The Sun doesn’t move across the sky; it only looks that way because we are spinning.\nThis view looks down on the North Pole, with day and night 12 hours each (as on the Equator, or anywhere at the equinoxes). The Earth also goes round the Sun once a year, which this leaves out.',
  mount({ stage, panel, api }) {
    let h = 9, run = null;
    const cv = canvas(stage, (ctx, w, hh) => {
      const cx = w * 0.6, cy = hh * 0.45, R = Math.min(w * 0.25, hh * 0.32);
      // the Sun (a lamp) and its light
      dot(ctx, 40, cy, 26, C.gold); text(ctx, 'Sun', 40, cy + 46, C.gold, 'center');
      for (let k = -2; k <= 2; k++) arrow(ctx, 80, cy + k * R * 0.4, cx - R - 14, cy + k * R * 0.4, 'rgba(255,207,90,.4)', 1.5);
      // the Earth: lit on the Sun's side
      dot(ctx, cx, cy, R, '#2a3a63'); ctx.fillStyle = '#4f8de0'; ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI / 2, (3 * Math.PI) / 2); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
      text(ctx, 'Day side', cx - R * 0.5, cy - R * 0.35, '#0b1a33', 'center'); text(ctx, 'Night side', cx + R * 0.5, cy - R * 0.35, INK, 'center');
      dot(ctx, cx, cy, 4, INK); text(ctx, 'North Pole', cx, cy + 16, DIM, 'center');
      // you and a friend on the far side: angle (y up) = π + (h − 12)·π/12, anticlockwise as time passes
      const put = (hour, col, lab) => { const a = Math.PI + ((hour - 12) * Math.PI) / 12, x = cx + Math.cos(a) * R, y = cy - Math.sin(a) * R; dot(ctx, x, y, 8, col); const ox = Math.cos(a) * 26, oy = -Math.sin(a) * 26; text(ctx, lab, x + ox, y + oy + 4, col, ox < -4 ? 'right' : ox > 4 ? 'left' : 'center'); };
      put(h, C.gold, 'You'); put(h + 12, C.teal, 'Friend');
      // the spin direction
      ctx.strokeStyle = DIM; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R + 30, -0.4, 0.4); ctx.stroke(); text(ctx, 'spins this way', cx + R + 34, cy - R * 0.5, DIM);
      arrow(ctx, cx + Math.cos(-0.35) * (R + 30), cy + Math.sin(-0.35) * (R + 30), cx + Math.cos(-0.42) * (R + 30), cy + Math.sin(-0.42) * (R + 30), DIM, 1.5);
      text(ctx, `${clockOf(h)} for you: ${isDay(h) ? 'day' : 'night'}`, 16, 22, isDay(h) ? C.gold : INK);
    });
    const tick = clock((dt) => { if (!run) return false; const step = Math.min(24 - run.done, dt * 3); run.done += step; set(h + step, true); if (run.done >= 24) { run = null; api.check(2); return false; } return true; });
    const sl = slider(group(panel, 'The time for you'), { label: 'Time', min: 0, max: 24, step: 0.25, value: h, fmt: (v) => clockOf(v), onInput: (v) => { run = null; tick.stop(); set(v); } });
    const r1 = row(panel, 'lab-row-btns');
    button(r1, 'Spin for a day', () => { if (calm()) { set(h + 24, true); api.check(2); return; } run = { done: 0 }; tick.start(); }, 'main');
    button(r1, 'Stop', () => { run = null; tick.stop(); });
    const st = stats(panel);
    function set(v, quiet) {
      h = (((Math.round(v * 3600) / 3600) % 24) + 24) % 24; sl.set(Math.round(h * 4) / 4);
      st.set([['Time for you', clockOf(h)], ['For you', isDay(h) ? 'Day' : 'Night'], ['Part of the day', partOf(h)], ['Time for your friend', clockOf(h + 12)], ['For your friend', isDay(h + 12) ? 'Day' : 'Night']]);
      if (!quiet || !run) { if (!isDay(h)) api.check(0); if (h >= 5.75 && h <= 6.25) api.check(1); }
      cv.redraw();
    }
    st.set([['Time for you', clockOf(h)], ['For you', 'Day'], ['Part of the day', partOf(h)], ['Time for your friend', clockOf(h + 12)], ['For your friend', 'Night']]);
    return { state: () => `the Earth turned so it is ${clockOf(h)} (${isDay(h) ? 'day' : 'night'}) for the student and ${clockOf(h + 12)} (${isDay(h + 12) ? 'day' : 'night'}) on the far side`, destroy: () => { tick.stop(); cv.destroy(); } };
  },
};

/* ---------------- Tectonic plates and earthquake waves ---------------- */
export const BOUNDARIES = { div: ['Divergent (apart)'], con: ['Convergent (together)'], tra: ['Transform (sliding past)'] };
export const QUAKE_AT = 100; // stress built on a locked fault before it slips (illustrative units: cm of plate motion)
// how far the plates have moved: cm a year × years → km
export const movedKm = (cmPerYr, years) => (cmPerYr * years) / 1e5;
// which waves reach a station an angle away from the quake (round the Earth's centre):
// S waves can't cross the liquid outer core, so none past about 104°; P waves bend in the core and leave a shadow from 104° to 140°
export const wavesAt = (deg) => ({ p: deg <= 104 || deg >= 140, s: deg <= 104 });
const tectonicsLab = {
  id: 'tectonics', name: 'Tectonic plates and earthquake waves', subject: 'space', levels: ['hs', 'college'], topic: 'plate tectonics: divergent, convergent and transform boundaries, earthquakes, P and S waves and the shadow zone',
  blurb: 'Move plates apart, together or past each other, set off earthquakes, and follow P and S waves through the Earth.',
  words: 'plate tectonics plates boundary divergent convergent transform subduction ridge rift volcano mountains fault earthquake seismic waves p wave s wave shadow zone outer core mantle crust',
  icon: '<path d="M4 30h18l4-6 4 6h14"/><path d="M4 36h40"/><path d="M26 24l-2-8M26 24l3-7"/><path d="M8 18l4-4 4 4"/>',
  tries: ['Pull two plates apart until 100 km of new ocean floor forms', 'Push an ocean plate under a continent until a volcano grows', 'Let a transform fault lock up, then slip as an earthquake', 'Find a place that feels no direct P or S waves', 'Find a place that feels P waves but no S waves'],
  hints: ['Choose Divergent and press “1 million years” until the plates have moved 100 km.', 'Choose Convergent and move the plates 100 km or more.', 'Choose Transform and keep moving the plates. Stress builds until the fault slips.', 'Switch to Earthquake waves and move the station between 104° and 140° from the quake.', 'Move the station past 140°. P waves get through the core there, but S waves never cross liquid.'],
  about: 'The Earth’s outer shell is broken into plates that move a few centimetres a year. Where they pull apart (divergent), magma rises and makes new crust, like the Mid-Atlantic Ridge. Where an ocean plate meets a continent (convergent), the denser ocean plate sinks under it (subduction), building mountains and volcanoes, like the Philippine Trench and Mayon. Where they slide past (transform), the fault locks, stress builds, and it slips in an earthquake.\nAn earthquake sends out P waves (push-pull, faster, through solids and liquids) and S waves (side to side, slower, through solids only). S waves can’t cross the liquid outer core, so stations more than about 104° away feel no S waves. P waves bend in the core, leaving a shadow zone from about 104° to 140°.\nThe speeds, stress and shapes are simplified to show the idea; real plates and faults are far more varied.',
  mount({ stage, panel, api }) {
    let mode = 'plates', kind = 'div', speed = 5, years = 0, stress = 0, quakes = 0, lastQuake = 0, deg = 60;
    const km = () => movedKm(speed, years);
    const cv = canvas(stage, (ctx, w, h) => {
      if (mode === 'plates') {
        const sea = h * 0.35, d = Math.min(w * 0.3, km() * 1.2), cx = w / 2;
        text(ctx, `${BOUNDARIES[kind][0]}: ${num(years / 1e6)} million years, plates moved ${num(km())} km`, 16, 22, INK);
        if (kind === 'div') {
          ctx.fillStyle = 'rgba(80,140,220,.35)'; ctx.fillRect(0, sea, w, h * 0.12);
          ctx.fillStyle = '#7d6a58'; ctx.fillRect(0, sea + h * 0.12, cx - d / 2, h * 0.1); ctx.fillRect(cx + d / 2, sea + h * 0.12, w, h * 0.1);
          ctx.fillStyle = '#c0573a'; ctx.fillRect(cx - d / 2, sea + h * 0.12, d, h * 0.1); // new crust
          ctx.fillStyle = 'rgba(255,120,60,.6)'; ctx.beginPath(); ctx.moveTo(cx - 30, h * 0.8); ctx.lineTo(cx, sea + h * 0.12); ctx.lineTo(cx + 30, h * 0.8); ctx.fill(); text(ctx, 'magma rises', cx + 36, h * 0.72, '#ff9a5c');
          arrow(ctx, cx - d / 2 - 20, sea + h * 0.28, cx - d / 2 - 90, sea + h * 0.28, INK); arrow(ctx, cx + d / 2 + 20, sea + h * 0.28, cx + d / 2 + 90, sea + h * 0.28, INK);
          if (d > 2) text(ctx, 'new ocean floor', cx, sea + h * 0.12 - 8, '#ff9a5c', 'center');
        } else if (kind === 'con') {
          const mtn = Math.min(h * 0.25, km() * 0.5);
          ctx.fillStyle = 'rgba(80,140,220,.35)'; ctx.fillRect(0, sea, cx, h * 0.1);
          ctx.fillStyle = '#5b6b7d'; ctx.beginPath(); ctx.moveTo(0, sea + h * 0.1); ctx.lineTo(cx, sea + h * 0.1); ctx.lineTo(cx + w * 0.25, h * 0.92); ctx.lineTo(cx + w * 0.18, h * 0.95); ctx.lineTo(cx - 10, sea + h * 0.2); ctx.lineTo(0, sea + h * 0.2); ctx.fill(); text(ctx, 'ocean plate sinks', cx + w * 0.02, h * 0.86, DIM);
          ctx.fillStyle = '#8a7660'; ctx.beginPath(); ctx.moveTo(cx, sea); ctx.lineTo(cx + w * 0.12, sea - mtn); ctx.lineTo(cx + w * 0.2, sea - mtn * 0.6); ctx.lineTo(w, sea); ctx.lineTo(w, sea + h * 0.2); ctx.lineTo(cx, sea + h * 0.1); ctx.fill();
          if (km() >= 100) { ctx.fillStyle = '#ff7a3c'; ctx.beginPath(); ctx.moveTo(cx + w * 0.12 - 10, sea - mtn); ctx.lineTo(cx + w * 0.12, sea - mtn - 16); ctx.lineTo(cx + w * 0.12 + 10, sea - mtn); ctx.fill(); text(ctx, 'volcano', cx + w * 0.12, sea - mtn - 24, '#ff9a5c', 'center'); }
          arrow(ctx, 30, sea + h * 0.15, 110, sea + h * 0.15, INK); arrow(ctx, w - 30, sea + h * 0.15, w - 110, sea + h * 0.15, INK);
        } else {
          const slip = Math.min(h * 0.3, quakes * 14); // (the road jumps each time the fault slips)
          ctx.fillStyle = 'rgba(140,160,110,.35)'; ctx.fillRect(0, 40, cx, h - 80); ctx.fillStyle = 'rgba(160,140,110,.35)'; ctx.fillRect(cx, 40, w - cx, h - 80);
          line(ctx, [[cx, 40], [cx, h - 40]], C.red, 2); text(ctx, 'fault', cx + 6, 56, C.red);
          // a road crossing the fault: offset by the slip so far
          line(ctx, [[20, h / 2 - slip / 2], [cx, h / 2 - slip / 2]], INK, 4); line(ctx, [[cx, h / 2 + slip / 2], [w - 20, h / 2 + slip / 2]], INK, 4);
          arrow(ctx, cx - 60, h - 60, cx - 60, h - 120, INK); arrow(ctx, cx + 60, 120, cx + 60, 180, INK);
          const bend = (stress / QUAKE_AT) * 30; ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 80, h / 2 - slip / 2); ctx.quadraticCurveTo(cx, h / 2 - slip / 2 + bend, cx + 80, h / 2 + slip / 2); ctx.stroke();
          text(ctx, `stress ${Math.round((stress / QUAKE_AT) * 100)}%`, 16, h - 16, stress > QUAKE_AT * 0.8 ? C.red : DIM);
          if (lastQuake && Date.now() - lastQuake < 2500) text(ctx, 'Earthquake! The fault slipped.', w / 2, 80, C.red, 'center');
        }
      } else {
        // the whole Earth: crust and mantle, liquid outer core, solid inner core, quake at the top
        const cx = w * 0.42, cy = h * 0.52, R = Math.min(w * 0.36, h * 0.4);
        dot(ctx, cx, cy, R, '#6d4c3d'); dot(ctx, cx, cy, R * 0.55, '#c7863c'); dot(ctx, cx, cy, R * 0.19, '#e8c66a');
        text(ctx, 'mantle', cx, cy - R * 0.75, INK, 'center'); text(ctx, 'liquid outer core', cx, cy - R * 0.3, '#1a1a1a', 'center'); text(ctx, 'inner core', cx, cy + 4, '#1a1a1a', 'center');
        const Q = [cx, cy - R]; dot(ctx, Q[0], Q[1], 7, C.red); text(ctx, 'quake', Q[0] + 10, Q[1] - 8, C.red);
        // shadow zones on both sides
        for (const s of [1, -1]) { ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, R + 8, -Math.PI / 2 + s * (104 * Math.PI) / 180, -Math.PI / 2 + s * (140 * Math.PI) / 180, s < 0); ctx.stroke(); }
        text(ctx, 'P-wave shadow zone (104° to 140°)', 16, h - 16, DIM);
        const a = -Math.PI / 2 + (deg * Math.PI) / 180, S = [cx + Math.cos(a) * R, cy + Math.sin(a) * R], W = wavesAt(deg);
        if (W.s || W.p) { ctx.setLineDash(W.s ? [] : [6, 5]); line(ctx, [Q, S], W.s ? C.teal : '#ff9a5c', 2.5); ctx.setLineDash([]); }
        dot(ctx, S[0], S[1], 8, C.gold); text(ctx, `station ${deg}°`, S[0] + (Math.cos(a) >= 0 ? 12 : -12), S[1] + 4, C.gold, Math.cos(a) >= 0 ? 'left' : 'right');
        text(ctx, `P waves: ${W.p ? 'arrive' : 'none'}. S waves: ${W.s ? 'arrive' : 'none'}.`, 16, 22, INK);
      }
    });
    const box = el('div'); panel.appendChild(box);
    const st = stats(panel);
    seg(group(box, 'Show'), { options: [['plates', 'Plate boundaries'], ['waves', 'Earthquake waves']], value: mode, onChange: (v) => { mode = v; build(); report(); } });
    const inner = el('div'); box.appendChild(inner);
    function step(n) {
      for (let i = 0; i < n; i++) {
        years += 1e5;
        if (kind === 'tra') { stress += speed * 2; if (stress >= QUAKE_AT) { stress = 0; quakes++; lastQuake = Date.now(); api.check(2); setTimeout(() => cv.redraw(), 2600); } }
      }
      if (kind === 'div' && km() >= 100) api.check(0);
      if (kind === 'con' && km() >= 100) api.check(1);
      report();
    }
    function build() {
      inner.replaceChildren();
      if (mode === 'plates') {
        seg(group(inner, 'Boundary'), { options: Object.entries(BOUNDARIES).map(([k, [n]]) => [k, n]), value: kind, onChange: (v) => { kind = v; years = 0; stress = 0; quakes = 0; report(); } });
        slider(group(inner, 'Speed'), { label: 'Plate speed', min: 1, max: 10, value: speed, fmt: (v) => `${v} cm a year`, onInput: (v) => { speed = v; report(); } });
        const r = row(inner, 'lab-row-btns');
        button(r, '100,000 years', () => step(1), 'main'); button(r, '1 million years', () => step(10)); button(r, 'Start again', () => { years = 0; stress = 0; quakes = 0; report(); });
      } else {
        slider(group(inner, 'Seismic station'), { label: 'Distance round the Earth', min: 0, max: 180, step: 2, value: deg, fmt: (v) => `${v}°`, onInput: (v) => { deg = v; report(true); } });
      }
    }
    function report(moved) {
      if (mode === 'plates') st.set([['Time', `${num(years / 1e6)} million years`], ['Plates moved', `${num(km())} km`], ['Speed', `${speed} cm a year`], ...(kind === 'tra' ? [['Stress on the fault', `${Math.round((stress / QUAKE_AT) * 100)}%`], ['Earthquakes', String(quakes)]] : [])]);
      else {
        const W = wavesAt(deg);
        st.set([['Station', `${deg}° from the quake`], ['Distance along the surface', `${Math.round(deg * 111.2).toLocaleString('en-US')} km`], ['P waves', W.p ? 'Arrive' : 'None (shadow zone)'], ['S waves', W.s ? 'Arrive' : 'None']]);
        if (moved) { if (!W.p && !W.s) api.check(3); if (W.p && !W.s) api.check(4); }
      }
      cv.redraw();
    }
    build(); report();
    return { state: () => (mode === 'plates' ? `a ${BOUNDARIES[kind][0].toLowerCase()} boundary after ${num(years / 1e6)} million years at ${speed} cm a year: the plates moved ${num(km())} km${kind === 'tra' ? `, ${quakes} earthquakes so far` : ''}` : `a seismic station ${deg}° from an earthquake: P waves ${wavesAt(deg).p ? 'arrive' : 'do not arrive'}, S waves ${wavesAt(deg).s ? 'arrive' : 'do not arrive'}`), destroy: () => cv.destroy() };
  },
};

/* ---------------- Unit circle and sine waves ---------------- */
export const trig = (deg) => { const r = (deg * Math.PI) / 180, s = Math.sin(r), c = Math.cos(r), z = (v) => (Math.abs(v) < 1e-12 ? 0 : v); return { s: z(s), c: z(c), t: Math.abs(c) < 1e-12 ? null : z(s / c) }; };
// the angle as a fraction of π, in lowest terms: 150° → 5π/6
export function radText(deg) {
  const g = (a, b) => (b ? g(b, a % b) : a), n = Math.round(deg), k = g(Math.abs(n), 180) || 180, p = n / k, q = 180 / k;
  if (n === 0) return '0';
  return `${p === 1 ? '' : p === -1 ? '−' : p}π${q === 1 ? '' : '/' + q}`;
}
export const quadrantOf = (deg) => { const a = ((deg % 360) + 360) % 360; return a % 90 === 0 ? 'On an axis' : ['First', 'Second', 'Third', 'Fourth'][Math.floor(a / 90)]; };
const unitCircleLab = {
  id: 'unitcircle', name: 'Unit circle and sine waves', subject: 'math', levels: ['hs', 'college'], topic: 'trigonometry: the unit circle, sine, cosine and tangent, radians and the sine wave',
  blurb: 'Turn a point round the unit circle and watch its height draw a sine wave. Degrees, radians, sin, cos and tan.',
  words: 'unit circle sine cosine tangent sin cos tan trigonometry radians degrees angle wave periodic quadrant',
  icon: '<circle cx="18" cy="24" r="12"/><path d="M18 24l9-8M27 16v8"/><path d="M32 24c3-10 6-10 8 0s5 10 8 0"/>',
  tries: ['Find an angle where sin and cos are equal', 'Find where sin is −1', 'Find the angle in the second quadrant where sin = 0.5', 'Go once round the circle and watch the wave repeat'],
  hints: ['Where the point is the same distance across as up: halfway between 0° and 90°.', 'sin is the point’s height. The lowest point of the circle.', 'sin 30° = 0.5. The second quadrant is between 90° and 180°: try 180° − 30°.', 'Press “Spin round” or slide the angle to 360°.'],
  about: 'On a circle of radius 1 centred at the origin, the point at angle θ (measured anticlockwise from the positive x-axis) is (cos θ, sin θ). So cos θ is how far across it is, and sin θ how far up. tan θ = sin θ ÷ cos θ, the slope of the radius; it is undefined where cos θ = 0 (90° and 270°).\nPlotting the height sin θ against θ gives the sine wave. It repeats every 360° (2π radians), because going once round brings the point back where it started.\nRadians measure the angle by the arc length on the unit circle: 360° = 2π, so 1 radian ≈ 57.3°. sin and cos are shown to 4 decimal places.',
  mount({ stage, panel, api }) {
    let deg = 30, unit = 'deg', run = null, maxDeg = 30;
    const geo = (w, h) => { const wide = w >= 560, R = wide ? Math.min(w * 0.18, h * 0.32) : Math.min(w * 0.3, h * 0.2); return { wide, R, cx: wide ? R + 40 : w / 2, cy: wide ? h * 0.48 : R + 50 }; };
    const cv = canvas(stage, (ctx, w, h) => {
      const { wide, R, cx, cy } = geo(w, h), T = trig(deg), a = (deg * Math.PI) / 180, px = cx + T.c * R, py = cy - T.s * R;
      line(ctx, [[cx - R - 16, cy], [cx + R + 16, cy]], FAINT, 1); line(ctx, [[cx, cy - R - 16], [cx, cy + R + 16]], FAINT, 1);
      ctx.strokeStyle = DIM; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
      ctx.strokeStyle = C.violet; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 22, 0, -(((deg % 360) + 360) % 360) * Math.PI / 180, true); ctx.stroke();
      line(ctx, [[cx, cy], [px, py]], INK, 2); line(ctx, [[cx, cy], [px, cy]], C.blue, 3); line(ctx, [[px, cy], [px, py]], C.gold, 3);
      dot(ctx, px, py, 8, INK); text(ctx, 'cos', (cx + px) / 2, cy + (T.s >= 0 ? 16 : -8), C.blue, 'center'); text(ctx, 'sin', px + (T.c >= 0 ? 8 : -8), (cy + py) / 2, C.gold, T.c >= 0 ? 'left' : 'right');
      // the wave: x is the angle (0 to 360°), y the height sin θ
      const gx = wide ? cx + R + 50 : 30, gw = wide ? w - gx - 24 : w - 54, gy = wide ? cy : cy + R + 40 + R * 0.8, A = wide ? R : R * 0.8;
      line(ctx, [[gx, gy], [gx + gw, gy]], FAINT, 1); line(ctx, [[gx, gy - A - 6], [gx, gy + A + 6]], FAINT, 1);
      for (const d of [90, 180, 270, 360]) text(ctx, unit === 'deg' ? `${d}°` : radText(d), gx + (d / 360) * gw, gy + A + 22, DIM, 'center');
      const shown = Math.min(360, Math.max(0, maxDeg)), pts = [];
      for (let d = 0; d <= shown; d += 2) pts.push([gx + (d / 360) * gw, gy - Math.sin((d * Math.PI) / 180) * A]);
      line(ctx, pts, C.gold, 2.5);
      const dd = ((deg % 360) + 360) % 360, wx = gx + (dd / 360) * gw, wy = gy - T.s * A;
      ctx.setLineDash([4, 4]); line(ctx, [[px, py], [wide ? wx : px, wide ? wy : py]], 'rgba(255,207,90,.4)', 1); ctx.setLineDash([]);
      dot(ctx, wx, wy, 6, C.gold);
      text(ctx, `θ = ${unit === 'deg' ? `${deg}°` : radText(deg)}   sin θ = ${T.s.toFixed(4)}   cos θ = ${T.c.toFixed(4)}`, 16, h - 14, INK);
    });
    drag(cv.c, { down: (p) => fromPoint(p), move: (p) => fromPoint(p) });
    function fromPoint(p) { const { R, cx, cy } = geo(cv.w, cv.h); if (Math.hypot(p.x - cx, p.y - cy) > R * 1.6) return false; let d = Math.round(((Math.atan2(cy - p.y, p.x - cx) * 180) / Math.PI) / 5) * 5; if (d < 0) d += 360; set(d); return true; }
    const tick = clock((dt) => { if (!run) return false; run.d = Math.min(360, run.d + dt * 90); set(Math.round(run.d), true); if (run.d >= 360) { run = null; return false; } return true; });
    seg(group(panel, 'Angle in'), { options: [['deg', 'Degrees'], ['rad', 'Radians']], value: unit, onChange: (v) => { unit = v; sl.set(deg); report(); } });
    const sl = slider(group(panel, 'The angle'), { label: 'Angle θ', min: 0, max: 360, step: 5, value: deg, fmt: (v) => (unit === 'deg' ? `${v}°` : radText(v)), onInput: (v) => { run = null; tick.stop(); set(v); } });
    const r1 = row(panel, 'lab-row-btns');
    button(r1, 'Spin round', () => { if (calm()) { maxDeg = 360; set(360); return; } run = { d: 0 }; maxDeg = 0; tick.start(); }, 'main');
    button(r1, 'Stop', () => { run = null; tick.stop(); });
    const st = stats(panel);
    function set(d, spinning) { deg = d; maxDeg = Math.max(maxDeg, d); sl.set(d); report(!spinning || d >= 360); }
    function report(acted) {
      const T = trig(deg);
      st.set([['Angle', `${deg}° = ${radText(deg)} rad`], ['sin θ', T.s.toFixed(4)], ['cos θ', T.c.toFixed(4)], ['tan θ', T.t === null ? 'Undefined' : T.t.toFixed(4)], ['Quadrant', quadrantOf(deg)]]);
      if (acted) {
        if (Math.abs(T.s - T.c) < 1e-9) api.check(0);
        if (Math.abs(T.s + 1) < 1e-9) api.check(1);
        if (deg > 90 && deg < 180 && Math.abs(T.s - 0.5) < 1e-9) api.check(2);
        if (maxDeg >= 360 && deg === 360) api.check(3);
      }
      cv.redraw();
    }
    report();
    return { state: () => { const T = trig(deg); return `the angle is ${deg}° (${radText(deg)} rad): sin ${T.s.toFixed(4)}, cos ${T.c.toFixed(4)}, tan ${T.t === null ? 'undefined' : T.t.toFixed(4)}`; }, destroy: () => { tick.stop(); cv.destroy(); } };
  },
};

/* ---------------- Contour maps ---------------- */
// height in metres at (x, y) km on a 2 km × 2 km map (y is north)
export const LANDFORMS = {
  hill: ['A hill', (x, y) => 100 + 400 * Math.exp(-((x - 1) ** 2 + (y - 1) ** 2) / 0.5)],
  saddle: ['Two hills and a saddle', (x, y) => 100 + 380 * Math.exp(-((x - 0.6) ** 2 + (y - 1) ** 2) / 0.12) + 320 * Math.exp(-((x - 1.4) ** 2 + (y - 1) ** 2) / 0.12)],
  valley: ['A river valley', (x, y) => 100 + 80 * y + 250 * Math.min(1, Math.abs(x - 1 - 0.12 * Math.sin(3 * y)) * 1.4)],
  cliff: ['A cliff', (x, y) => 100 + 300 / (1 + Math.exp(-(x - 1 + 0.15 * Math.sin(2 * y)) / 0.03)) + 20 * y],
};
// the cross-section west to east at y: heights every 10 m, and the steepest slope (degrees) along it
export function profile(kind, y, n = 200) {
  const f = LANDFORMS[kind][1], pts = [];
  for (let i = 0; i <= n; i++) { const x = (2 * i) / n; pts.push([x, f(x, y)]); }
  let steep = 0; for (let i = 1; i < pts.length; i++) steep = Math.max(steep, (Math.atan(Math.abs(pts[i][1] - pts[i - 1][1]) / ((pts[i][0] - pts[i - 1][0]) * 1000)) * 180) / Math.PI);
  // a hilltop: the highest point within 400 m either side, with the land dropping at least 20 m on both sides
  const peaks = pts.filter((p, i) => { const L = pts.slice(Math.max(0, i - 40), i).map((q) => q[1]), R = pts.slice(i + 1, i + 41).map((q) => q[1]); return L.length && R.length && p[1] > Math.max(...L) && p[1] >= Math.max(...R) && p[1] - Math.min(...L) > 20 && p[1] - Math.min(...R) > 20; }).length;
  return { pts, top: Math.max(...pts.map((p) => p[1])), low: Math.min(...pts.map((p) => p[1])), steep, peaks };
}
export function mapTop(kind) { const f = LANDFORMS[kind][1]; let t = -Infinity; for (let i = 0; i <= 100; i++) for (let j = 0; j <= 100; j++) t = Math.max(t, f(i / 50, j / 50)); return t; }
const contoursLab = {
  id: 'contours', name: 'Contour maps', subject: 'geography', levels: ['hs', 'college'], topic: 'topographic maps: contour lines, contour interval, relief, slope and cross-section profiles',
  blurb: 'Read contour lines on a map, cut a cross-section through hills, valleys and cliffs, and measure how steep they are.',
  words: 'contour map contour lines topographic map topography elevation height relief slope gradient cross section profile hill valley ridge saddle cliff contour interval',
  icon: '<path d="M8 24c0-10 10-16 18-14s14 10 12 18-12 12-20 10S8 32 8 24z"/><path d="M15 24c0-5 5-8 10-7s7 5 6 9-6 6-10 5-6-3-6-7z"/><circle cx="23" cy="23" r="2"/>',
  tries: ['Cut a cross-section right over the top of the hill', 'Find a slope steeper than 45°', 'Cut across the saddle so the profile shows both hills'],
  hints: ['Choose A hill and slide the cross-section to the middle, where the rings are smallest.', 'Choose A cliff. Where contour lines crowd together the land is steep.', 'Choose Two hills and a saddle and put the cut through both sets of rings.'],
  about: 'A contour line joins points at the same height above sea level. The contour interval is the height between neighbouring lines. Lines close together mean a steep slope; far apart, gentle. Rings inside rings are a hill, and contours in a river valley make V shapes that point uphill.\nA cross-section (profile) shows the height along a line across the map, like slicing the land and looking at it from the side. Slope = rise ÷ run, and its angle is arctan(rise ÷ run).\nThe landforms are made from smooth formulas on a 2 km square, not a real place.',
  mount({ stage, panel, api }) {
    let kind = 'hill', step = 50, cutY = 1.4;
    const cv = canvas(stage, (ctx, w, h) => {
      const wide = w >= 620, S = wide ? Math.min(h - 70, w * 0.5) : Math.min(w - 40, h * 0.55), mx = 20, my = 36, f = LANDFORMS[kind][1];
      const P = profile(kind, cutY), N = 70, cell = S / N, H = [];
      for (let j = 0; j <= N; j++) { H.push([]); for (let i = 0; i <= N; i++) H[j].push(f((2 * i) / N, 2 - (2 * j) / N)); }
      // a light shade by height, then the contours (marching squares)
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const v = (H[j][i] - 100) / 450; ctx.fillStyle = `rgb(${Math.round(52 + 45 * v)},${Math.round(70 + 25 * v)},${Math.round(52 - 8 * v)})`; ctx.fillRect(mx + i * cell, my + j * cell, cell + 0.5, cell + 0.5); }
      ctx.strokeRect(mx, my, S, S);
      for (let lev = step; lev < 1000; lev += step) {
        const major = lev % (step * 5) === 0; ctx.strokeStyle = major ? '#f0d9a8' : 'rgba(240,217,168,.7)'; ctx.lineWidth = major ? 2 : 1; ctx.beginPath();
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const a = H[j][i], b = H[j][i + 1], c = H[j + 1][i + 1], d = H[j + 1][i], X = mx + i * cell, Y = my + j * cell, pts = [];
          const e = (p, q, x1, y1, x2, y2) => { if ((p < lev) !== (q < lev)) { const t = (lev - p) / (q - p); pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]); } };
          e(a, b, X, Y, X + cell, Y); e(b, c, X + cell, Y, X + cell, Y + cell); e(d, c, X, Y + cell, X + cell, Y + cell); e(a, d, X, Y, X, Y + cell);
          if (pts.length >= 2) { ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); } if (pts.length === 4) { ctx.moveTo(pts[2][0], pts[2][1]); ctx.lineTo(pts[3][0], pts[3][1]); }
        }
        ctx.stroke();
      }
      const ly = my + ((2 - cutY) / 2) * S; line(ctx, [[mx, ly], [mx + S, ly]], C.red, 2.5); text(ctx, 'A', mx - 4, ly + 4, C.red, 'right'); text(ctx, 'B', mx + S + 4, ly + 4, C.red);
      text(ctx, 'N ↑', mx + S - 30, my - 10, DIM); text(ctx, `Contour interval ${step} m`, mx, my - 12, INK);
      // the profile from A to B
      const gx = wide ? mx + S + 50 : mx + 30, gy = wide ? my + 10 : my + S + 40, gw = wide ? w - gx - 20 : w - gx - 20, gh = wide ? S * 0.6 : h - gy - 50;
      if (gh > 40) {
        line(ctx, [[gx, gy], [gx, gy + gh], [gx + gw, gy + gh]], FAINT, 1); text(ctx, 'height (m)', gx + 4, gy + 10, DIM); text(ctx, 'A', gx, gy + gh + 16, C.red, 'center'); text(ctx, 'B (2 km)', gx + gw, gy + gh + 16, C.red, 'right');
        for (const v of [0, 250, 500]) text(ctx, String(v), gx - 6, gy + gh - (v / 600) * gh + 4, DIM, 'right');
        ctx.fillStyle = 'rgba(160,190,120,.4)'; ctx.beginPath(); ctx.moveTo(gx, gy + gh); P.pts.forEach(([x, z]) => ctx.lineTo(gx + (x / 2) * gw, gy + gh - (z / 600) * gh)); ctx.lineTo(gx + gw, gy + gh); ctx.fill();
        line(ctx, P.pts.map(([x, z]) => [gx + (x / 2) * gw, gy + gh - (z / 600) * gh]), INK, 2);
        text(ctx, 'Cross-section A to B (height stretched)', gx, gy + gh + 34, DIM);
      }
    });
    seg(group(panel, 'Landform'), { options: Object.entries(LANDFORMS).map(([k, [n]]) => [k, n]), value: kind, onChange: (v) => { kind = v; report(); } });
    seg(group(panel, 'Contour interval'), { options: [[10, '10 m'], [20, '20 m'], [50, '50 m']], value: step, onChange: (v) => { step = v; report(); } });
    slider(group(panel, 'Cross-section'), { label: 'Cut line (km north)', min: 0, max: 2, step: 0.05, value: cutY, fmt: (v) => `${v.toFixed(2)} km`, onInput: (v) => { cutY = v; report(true); } });
    const st = stats(panel);
    function report(acted) {
      const P = profile(kind, cutY), top = mapTop(kind);
      st.set([['Highest point on the map', `${Math.round(top)} m`], ['Highest on the cut', `${Math.round(P.top)} m`], ['Lowest on the cut', `${Math.round(P.low)} m`], ['Steepest slope on the cut', `${num(P.steep)}°`], ['Hilltops on the cut', String(P.peaks)]]);
      if (acted) {
        if (kind === 'hill' && P.top >= top - 5) api.check(0);
        if (P.steep > 45) api.check(1);
        if (kind === 'saddle' && P.peaks >= 2) api.check(2);
      }
      cv.redraw();
    }
    report();
    return { state: () => { const P = profile(kind, cutY); return `${LANDFORMS[kind][0].toLowerCase()} with ${step} m contours, cut west to east at ${cutY.toFixed(2)} km north: heights ${Math.round(P.low)} to ${Math.round(P.top)} m, steepest slope ${num(P.steep)}°, ${P.peaks} hilltops on the cut`; }, destroy: () => cv.destroy() };
  },
};

export const EARTHMATH = [dayNightLab, tectonicsLab, unitCircleLab, contoursLab];

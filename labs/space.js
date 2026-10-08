/* The solar system: the eight planets where they really are today (JPL's approximate orbital
   elements), moving on their true ellipses — and the Moon's phases and eclipses from a short
   version of the standard lunar theory (Meeus). Drag to turn and tilt; tap a planet. */
import { INK, DIM, FAINT, GRID, C, el, esc, num, canvas, drag, clock, group, seg, button, row, stats, line, dot, text, overlay } from './kit.js';

const RAD = Math.PI / 180, AU_KM = 149597870.7, J2000 = Date.UTC(2000, 0, 1, 12);
// [name, a (AU), e, mean longitude at J2000 (°), its rate (° per century), longitude of perihelion (°),
//  diameter (km), day length (hours, − = spins backwards), known moons, mean temperature (°C), kind, colour]
export const PLANETS = [
  ['Mercury', 0.38709927, 0.20563593, 252.25032350, 149472.67411175, 77.45779628, 4879, 1407.6, 0, 167, 'rocky', '#b1aca5'],
  ['Venus', 0.72333566, 0.00677672, 181.97909950, 58517.81538729, 131.60246718, 12104, -5832.5, 0, 464, 'rocky', '#e8cf9a'],
  ['Earth', 1.00000261, 0.01671123, 100.46457166, 35999.37244981, 102.93768193, 12756, 23.9, 1, 15, 'rocky', '#4f8fd8'],
  ['Mars', 1.52371034, 0.09339410, -4.55343205, 19140.30268499, -23.94362959, 6792, 24.6, 2, -65, 'rocky', '#d0643f'],
  ['Jupiter', 5.20288700, 0.04838624, 34.39644051, 3034.74612775, 14.72847983, 142984, 9.9, 95, -110, 'gas giant', '#d9b38a'],
  ['Saturn', 9.53667594, 0.05386179, 49.95424423, 1222.49362201, 92.59887831, 120536, 10.7, 274, -140, 'gas giant', '#e6cf91'],
  ['Uranus', 19.18916464, 0.04725744, 313.23810451, 428.48202785, 170.95427630, 51118, -17.2, 28, -195, 'ice giant', '#9fd8de'],
  ['Neptune', 30.06992276, 0.00859048, -55.12002969, 218.45945325, 44.96476227, 49528, 16.1, 16, -200, 'ice giant', '#4b6fd6'],
];
const daysOf = (ms) => (ms - J2000) / 86400000;
const wrap = (deg) => ((deg % 360) + 360) % 360;
// where a planet is (AU, in the plane of Earth's orbit) on a given day
export function planetAt(p, d) {
  const [, a, e, L0, Lr, w] = p;
  const M = wrap(L0 + (Lr * d) / 36525 - w) * RAD;
  let E = M;
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); // Kepler's equation
  const x = a * (Math.cos(E) - e), y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const lon = Math.atan2(y, x) + w * RAD, r = Math.hypot(x, y);
  return { x: r * Math.cos(lon), y: r * Math.sin(lon), r };
}
export const periodDays = (p) => (36525 * 360) / p[4];

/* ---------- the Moon (after Meeus: mean elements and the biggest periodic terms) ---------- */
export function moonAt(d) {
  const D = 297.8501921 + 12.19074912 * d, M = 357.5291092 + 0.98560028 * d, Mp = 134.9633964 + 13.06499295 * d, F = 93.2720950 + 13.22935024 * d;
  const s = (deg) => Math.sin(deg * RAD);
  const moonLon = 6.288774 * s(Mp) + 1.274027 * s(2 * D - Mp) + 0.658314 * s(2 * D) + 0.213618 * s(2 * Mp) - 0.185116 * s(M) - 0.114332 * s(2 * F);
  const sunLon = 1.914602 * s(M) + 0.019993 * s(2 * M);
  const elong = wrap(D + moonLon - sunLon); // 0 = new moon, 180 = full moon
  const lat = 5.128122 * s(F) + 0.280602 * s(Mp + F) + 0.277693 * s(Mp - F) + 0.173237 * s(2 * D - F);
  return { elong, lat, lit: (1 - Math.cos(elong * RAD)) / 2 };
}
export function phaseName(e) {
  if (e < 7 || e >= 353) return 'New moon';
  if (e < 83) return 'Waxing crescent';
  if (e < 97) return 'First quarter';
  if (e < 173) return 'Waxing gibbous';
  if (e < 187) return 'Full moon';
  if (e < 263) return 'Waning gibbous';
  if (e < 277) return 'Last quarter';
  return 'Waning crescent';
}
// the next moment the Moon reaches an elongation (0 = new, 180 = full), searching forward from day d
export function nextPhase(d, target) {
  const off = (x) => { const v = wrap(moonAt(x).elong - target); return v > 180 ? v - 360 : v; };
  let a = d, fa = off(a);
  for (let i = 0; i < 80; i++) {
    const b = a + 0.5, fb = off(b);
    if (fa < 0 && fb >= 0 && fb - fa < 90) { let lo = a, hi = b; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (off(m) < 0) lo = m; else hi = m; } return (lo + hi) / 2; }
    a = b; fa = fb;
  }
  return null;
}
// an eclipse can happen only at a new or full moon when the Moon is close to the plane of Earth's orbit
// (limits checked against every real eclipse of 2024–2028: all found, none invented)
const ECLIPSE_LAT = { solar: 1.45, lunar: 1.45 };
export function nextEclipse(d, kind) {
  let t = d;
  for (let i = 0; i < 60; i++) {
    const at = nextPhase(t, kind === 'solar' ? 0 : 180);
    if (at == null) return null;
    if (Math.abs(moonAt(at).lat) < ECLIPSE_LAT[kind]) return at;
    t = at + 1;
  }
  return null;
}
const dateOf = (d) => new Date(J2000 + d * 86400000);
const fmtDate = (d) => dateOf(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

const solarLab = {
  id: 'solar', name: 'Planets today, Moon & eclipses', subject: 'space', topic: 'the solar system: planets, orbits, the Moon’s phases and eclipses',
  blurb: 'The eight planets where they really are today, the Moon’s phases, and when the next eclipses come.',
  words: 'solar system planets sun orbit moon phases eclipse astronomy space kepler year',
  icon: '<circle cx="24" cy="24" r="5"/><ellipse cx="24" cy="24" rx="19" ry="8"/><circle cx="41" cy="22" r="2.5"/><ellipse cx="24" cy="24" rx="11" ry="4.5"/><circle cx="14" cy="27" r="1.6"/>',
  tries: ['Find how many Earth years one year on Neptune lasts', 'Speed up time and watch Mercury lap the Earth', 'Find the date of the next solar eclipse'],
  hints: ['Tap Neptune and read its “Year” in the numbers below.', 'Set the speed to “1 month per second” and watch the inner planets. Mercury goes round about 4 times for each Earth year.', 'Switch the view to “Moon & eclipses” and read “Next solar eclipse”.'],
  about: 'Planet positions use JPL’s approximate orbital elements (accurate to a fraction of a degree for these decades), solved with Kepler’s equation on each planet’s real ellipse. The small tilts of the orbits (all within 7° of Earth’s) are flattened onto one plane.\nPlanets are drawn far bigger than to scale so you can see them — switch Sizes to “True scale” to see how small they really are. “Squeezed” distances shrink the outer solar system so it fits; “True” distances are to scale.\nMoon phases and eclipses use a simplified lunar theory (after Meeus). Eclipse dates were checked against every real eclipse of 2024–2028 (all found, none invented); much further in the future a borderline faint (penumbral) eclipse could be missed, and it doesn’t say where on Earth an eclipse is visible.\nMoon counts are the officially confirmed numbers as of 2025 — astronomers keep finding more around the giant planets.',
  mount({ stage, panel, api }) {
    let mode = 'planets', dist = 'squeezed', sizes = 'big', speed = 0, day = daysOf(Date.now()), pick = 'Earth';
    let rot = -0.5, tilt = 55 * RAD, zoom = 1, dragMoon = false;
    const raceStart = { day: null, laps: 0 };
    let shown = [];
    function radiusOf(a, R) { return dist === 'true' ? (a / 30.3) * R : (Math.sqrt(a) / Math.sqrt(30.3)) * R; }
    const cv = canvas(stage, (ctx, w, h) => {
      if (mode === 'planets') drawPlanets(ctx, w, h); else drawMoon(ctx, w, h);
      text(ctx, fmtDate(day), 12, 20, INK);
      text(ctx, speed ? ['', '1 day', '1 week', '1 month', '1 year'][[0, 1, 7, 30, 365].indexOf(speed)] + ' per second' : 'paused', 12, 38, DIM);
    });
    function drawPlanets(ctx, w, h) {
      const cx = w / 2, cy = h / 2 + 10, R = (Math.min(w, h * 1.6) / 2 - 24) * zoom;
      const proj = (x, y) => { const X = x * Math.cos(rot) - y * Math.sin(rot), Y = x * Math.sin(rot) + y * Math.cos(rot); return [cx + X, cy + Y * Math.sin(tilt), Y]; };
      const scale = (a) => radiusOf(a, R) / a;
      // the orbits
      PLANETS.forEach((p) => {
        ctx.strokeStyle = p[0] === pick ? 'rgba(255,255,255,.4)' : 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.beginPath();
        for (let k = 0; k <= 120; k++) {
          const q = planetAt(p, day + (periodDays(p) * k) / 120), s = radiusOf(q.r, R) / q.r, [X, Y] = proj(q.x * s, q.y * s);
          if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
        }
        ctx.stroke();
      });
      // the Sun and planets, farthest first
      const pxPerKm = (radiusOf(1, R)) / AU_KM;
      const bodies = PLANETS.map((p) => {
        const q = planetAt(p, day), s = radiusOf(q.r, R) / q.r, [X, Y, depth] = proj(q.x * s, q.y * s);
        const r = sizes === 'big' ? 3 + 2.6 * Math.log10(p[6] / 1000) * (p[6] > 50000 ? 1.5 : 1) : Math.max(0.6, (p[6] / 2) * pxPerKm);
        return { p, X, Y, depth, r };
      });
      const sunR = sizes === 'big' ? 14 : Math.max(0.8, (1392700 / 2) * pxPerKm);
      [...bodies, { sun: true, X: cx, Y: cy, depth: 0, r: sunR }].sort((a, b) => a.depth - b.depth).forEach((b) => {
        if (b.sun) {
          const g = ctx.createRadialGradient(b.X, b.Y, 0, b.X, b.Y, b.r * 2.4);
          g.addColorStop(0, 'rgba(255,207,90,.55)'); g.addColorStop(1, 'rgba(255,207,90,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.X, b.Y, b.r * 2.4, 0, Math.PI * 2); ctx.fill();
          dot(ctx, b.X, b.Y, b.r, '#ffd56b');
          return;
        }
        const { p } = b;
        if (p[0] === 'Saturn' && sizes === 'big') { ctx.strokeStyle = 'rgba(230,207,145,.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(b.X, b.Y, b.r * 2, b.r * 2 * Math.max(0.25, Math.sin(tilt) * 0.5), -0.3, 0, Math.PI * 2); ctx.stroke(); }
        // lit from the Sun's side
        const g = ctx.createRadialGradient(b.X - (b.X - cx) / Math.max(1, Math.hypot(b.X - cx, b.Y - cy)) * b.r * 0.6, b.Y - (b.Y - cy) / Math.max(1, Math.hypot(b.X - cx, b.Y - cy)) * b.r * 0.6, 0, b.X, b.Y, b.r);
        g.addColorStop(0, p[11]); g.addColorStop(1, 'rgba(10,10,14,.9)');
        ctx.fillStyle = sizes === 'big' ? g : p[11]; ctx.beginPath(); ctx.arc(b.X, b.Y, b.r, 0, Math.PI * 2); ctx.fill();
        if (p[0] === pick) { ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(b.X, b.Y, b.r + 5, 0, Math.PI * 2); ctx.stroke(); }
        if (w > 500 || p[0] === pick || ['Earth', 'Jupiter', 'Saturn', 'Neptune'].includes(p[0])) text(ctx, p[0], b.X + b.r + 4, b.Y - b.r - 2, p[0] === pick ? INK : DIM);
      });
      shown = bodies;
      if (sizes === 'true') text(ctx, 'True sizes: the planets are smaller than one pixel at this scale', w / 2, h - 12, DIM, 'center');
    }
    function drawMoon(ctx, w, h) {
      const m = moonAt(day), cx = w * (w > 640 ? 0.42 : 0.5), cy = h * 0.5, R = Math.min(w * 0.32, h * 0.36);
      // sunlight from the left
      for (let k = 0; k < 7; k++) { const y = cy - R * 1.1 + (k * R * 2.2) / 6; ctx.setLineDash([2, 8]); line(ctx, [[8, y], [cx - R * 1.25, y]], 'rgba(255,207,90,.35)', 1); }
      ctx.setLineDash([]);
      text(ctx, '← sunlight comes from the Sun, far off to the left', 12, h - 14, C.gold);
      ctx.strokeStyle = FAINT; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      // Earth: day side toward the Sun
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#18324f'; ctx.fillRect(cx - 18, cy - 18, 36, 36); ctx.fillStyle = '#4f8fd8'; ctx.fillRect(cx - 18, cy - 18, 18, 36); ctx.restore();
      text(ctx, 'Earth', cx, cy + 34, DIM, 'center');
      // the Moon on its orbit (anticlockwise, seen from above the north pole)
      const ang = Math.PI + m.elong * RAD, mx = cx + Math.cos(ang) * R, my = cy - Math.sin(ang) * R;
      moonXY = [mx, my, cx, cy, R];
      ctx.save(); ctx.beginPath(); ctx.arc(mx, my, 11, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#2b2b30'; ctx.fillRect(mx - 11, my - 11, 22, 22); ctx.fillStyle = '#e9e6dc'; ctx.fillRect(mx - 11, my - 11, 11, 22); ctx.restore();
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(mx, my, 15, 0, Math.PI * 2); ctx.stroke();
      // how it looks from Earth (northern hemisphere: the right side lights up first)
      const ix = w > 640 ? w - 110 : w - 70, iy = w > 640 ? 110 : 64, ir = w > 640 ? 64 : 40;
      text(ctx, 'From Earth', ix, iy - ir - 10, DIM, 'center');
      dot(ctx, ix, iy, ir, '#2b2b30');
      ctx.fillStyle = '#e9e6dc'; ctx.beginPath();
      const waxing = m.elong < 180, k = Math.cos(m.elong * RAD); // terminator: an ellipse of half-width |k|·r
      ctx.arc(ix, iy, ir, -Math.PI / 2, Math.PI / 2, !waxing);
      ctx.ellipse(ix, iy, Math.abs(k) * ir, ir, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === waxing);
      ctx.fill();
      text(ctx, phaseName(m.elong), ix, iy + ir + 18, INK, 'center');
      // eclipse right now?
      const near0 = m.elong < 1.5 || m.elong > 358.5, near180 = Math.abs(m.elong - 180) < 1.5;
      if ((near0 && Math.abs(m.lat) < ECLIPSE_LAT.solar) || (near180 && Math.abs(m.lat) < ECLIPSE_LAT.lunar)) text(ctx, near0 ? 'Solar eclipse today (seen from part of Earth)' : 'Lunar eclipse today', cx, 24, C.gold, 'center');
      // the Moon's height above Earth's orbit plane
      text(ctx, `Moon ${num(Math.abs(m.lat))}° ${m.lat >= 0 ? 'above' : 'below'} the plane of Earth’s orbit`, cx, cy + R + 28, DIM, 'center');
    }
    let moonXY = null;
    // drag: turn and tilt the planets; drag the Moon round its orbit
    let last = null;
    drag(cv.c, {
      down(p) {
        last = p; dragMoon = false;
        if (mode === 'moon' && moonXY && Math.hypot(p.x - moonXY[0], p.y - moonXY[1]) < 30) dragMoon = true;
      },
      move(p) {
        if (mode === 'moon') {
          if (!dragMoon) return;
          const [, , cx, cy] = moonXY, want = wrap((Math.atan2(-(p.y - cy), p.x - cx) - Math.PI) / RAD), now = moonAt(day).elong;
          let diff = wrap(want - now); if (diff > 180) diff -= 360;
          day += diff / 12.19; report();
          return;
        }
        rot += (p.x - last.x) * 0.01; tilt = Math.max(8 * RAD, Math.min(90 * RAD, tilt - (p.y - last.y) * 0.01)); last = p; cv.redraw();
      },
    });
    cv.c.addEventListener('click', (e) => {
      if (mode !== 'planets') return;
      const r0 = cv.c.getBoundingClientRect(), x = e.clientX - r0.left, y = e.clientY - r0.top;
      const hit = shown.map((b) => ({ b, d: Math.hypot(b.X - x, b.Y - y) - Math.max(b.r, 6) })).sort((a, b) => a.d - b.d)[0];
      if (hit && hit.d < 16) { pick = hit.b.p[0]; report(); if (pick === 'Neptune') api.check(0); }
    });
    cv.c.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.6, Math.min(12, zoom * Math.exp(-e.deltaY * 0.0015))); cv.redraw(); }, { passive: false });
    const tick = clock((dt) => {
      if (!speed || dragMoon) return true;
      const before = planetAt(PLANETS[0], day), beforeE = planetAt(PLANETS[2], day);
      day += speed * dt;
      // Mercury lapping Earth: count how often it passes between Earth and the Sun's direction
      const a0 = Math.atan2(before.y, before.x) - Math.atan2(beforeE.y, beforeE.x), m = planetAt(PLANETS[0], day), e = planetAt(PLANETS[2], day), a1 = Math.atan2(m.y, m.x) - Math.atan2(e.y, e.x);
      if (Math.sin(a0) < 0 && Math.sin(a1) >= 0 && Math.cos(a1) > 0) { raceStart.laps++; if (raceStart.laps >= 2) api.check(1); }
      report(true);
      return true;
    });
    const ov = overlay(stage, 'br');
    button(ov, '−', () => { zoom = Math.max(0.6, zoom / 1.4); cv.redraw(); });
    button(ov, '+', () => { zoom = Math.min(12, zoom * 1.4); cv.redraw(); });
    seg(group(panel, 'View'), { options: [['planets', 'Planets'], ['moon', 'Moon & eclipses']], value: mode, onChange: (v) => { mode = v; ov.hidden = v !== 'planets'; planetBox.hidden = v !== 'planets'; if (v === 'moon') api.check(2); report(); } });
    seg(group(panel, 'Time'), { options: [[0, 'Pause'], [1, '1 day/s'], [7, '1 week/s'], [30, '1 month/s'], [365, '1 year/s']], value: speed, onChange: (v) => { speed = v; } });
    button(row(panel, 'lab-row-btns'), 'Back to today', () => { day = daysOf(Date.now()); report(); });
    const planetBox = el('div');
    panel.appendChild(planetBox);
    seg(group(planetBox, 'Distances'), { options: [['squeezed', 'Squeezed to fit'], ['true', 'True scale']], value: dist, onChange: (v) => { dist = v; cv.redraw(); } });
    seg(group(planetBox, 'Sizes'), { options: [['big', 'Big (to see them)'], ['true', 'True scale']], value: sizes, onChange: (v) => { sizes = v; cv.redraw(); } });
    planetBox.appendChild(el('p', 'lab-note', 'Drag to turn and tilt. Tap a planet for its facts.'));
    const st = stats(panel);
    let lastReport = 0;
    function report(soft) {
      const now = performance.now();
      if (soft && now - lastReport < 250) { cv.redraw(); return; }
      lastReport = now;
      if (mode === 'planets') {
        const p = PLANETS.find((q) => q[0] === pick), q = planetAt(p, day), P = periodDays(p), e = planetAt(PLANETS[2], day);
        st.set([[p[0], `${p[10]} planet`], ['Width', `${p[6].toLocaleString()} km (${num(p[6] / 12756)} × Earth)`], ['Distance from the Sun', `${num(q.r)} AU = ${num((q.r * AU_KM) / 1e6)} million km`], ['Year (once round the Sun)', P > 700 ? `${num(P / 365.25)} Earth years` : `${num(P)} Earth days`],
          ['Day (one spin)', `${num(Math.abs(p[7]))} hours${p[7] < 0 ? ' — it spins backwards' : ''}${Math.abs(p[7]) > 48 ? ` (${num(Math.abs(p[7]) / 24)} Earth days)` : ''}`], ['Known moons', String(p[8])], ['Average temperature', `${p[9]} °C`], ...(p[0] !== 'Earth' ? [['Distance from Earth now', `${num(Math.hypot(q.x - e.x, q.y - e.y))} AU`]] : [])]);
      } else {
        const m = moonAt(day), nf = nextPhase(day, 180), nn = nextPhase(day, 0), se = nextEclipse(day, 'solar'), le = nextEclipse(day, 'lunar');
        st.set([['Phase', `${phaseName(m.elong)} — ${Math.round(m.lit * 100)}% lit`], ['Days since new moon', num((m.elong / 360) * 29.53)], ['Next full moon', nf ? fmtDate(nf) : '—'], ['Next new moon', nn ? fmtDate(nn) : '—'], ['Next solar eclipse', se ? fmtDate(se) : 'none in 5 years'], ['Next lunar eclipse', le ? fmtDate(le) : 'none in 5 years']]);
      }
      cv.redraw();
    }
    report(); tick.start();
    return {
      state: () => {
        if (mode === 'moon') { const m = moonAt(day); return `the Moon on ${fmtDate(day)}: ${phaseName(m.elong)}, ${Math.round(m.lit * 100)}% lit, ${num(m.lat)}° from the plane of Earth’s orbit`; }
        const p = PLANETS.find((q) => q[0] === pick), q = planetAt(p, day);
        return `the solar system on ${fmtDate(day)}; I picked ${p[0]}, now ${num(q.r)} AU from the Sun, whose year lasts ${num(periodDays(p))} Earth days`;
      },
      destroy: () => { tick.stop(); cv.destroy(); },
    };
  },
};

export const SPACE = [solarLab];

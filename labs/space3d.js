/* Space in 3D: the solar system (the planets where they really are today), then zoom out to the
   Milky Way, the Local Group of galaxies, and the wider universe. Tap anything to fly to it and
   read about it; drag to turn, pinch or scroll to zoom — scrolling out past the edge of one
   scale opens the next one. */
import { el, esc, num, group, seg, button, row, stats, overlay } from './kit.js';
import { stage3d, webglOk, paintTexture, noise2 } from './three-kit.js';
import { PLANETS, planetAt, periodDays } from './space.js';
import { planetLook } from './planet-look.js';

const J2000 = Date.UTC(2000, 0, 1, 12), DAY = 86400000, AU_KM = 149597870.7, LY_KM = 9.4607e12;
const today = () => (Date.now() - J2000) / DAY;
const big = (n) => (n >= 1e9 ? `${num(n / 1e9, 3)} billion` : n >= 1e6 ? `${num(n / 1e6, 3)} million` : Math.round(n).toLocaleString());

// facts: gravity at the surface (m/s²), mass (Earths), axial tilt (°), and one thing to remember
const MORE = {
  Mercury: [3.7, 0.055, 0.03, 'The smallest planet and the closest to the Sun. It has almost no air, so days reach 430 °C and nights fall to −180 °C.'],
  Venus: [8.87, 0.815, 177.4, 'The hottest planet: its thick carbon-dioxide air traps heat. It spins backwards, and one day there is longer than its year.'],
  Earth: [9.81, 1, 23.44, 'The only place we know has life. About 71% of its surface is ocean, and its tilt gives us the seasons.'],
  Mars: [3.71, 0.107, 25.19, 'Red because of iron-oxide (rust) dust. It has Olympus Mons, the tallest volcano in the solar system (about 22 km high).'],
  Jupiter: [24.79, 317.8, 3.13, 'The biggest planet — more than 1,300 Earths would fit inside. The Great Red Spot is a storm wider than Earth.'],
  Saturn: [10.44, 95.2, 26.73, 'Its rings are mostly chunks of ice, hundreds of thousands of km wide but often only about 10 m thick. Saturn is less dense than water.'],
  Uranus: [8.69, 14.5, 97.77, 'It is tipped on its side, so each pole gets about 42 years of sunlight, then 42 years of darkness.'],
  Neptune: [11.15, 17.1, 28.32, 'The windiest planet — winds over 2,000 km/h. It was found by maths (1846) before anyone had seen it.'],
};
const TILT = { Sun: 7.25, Moon: 6.7, Pluto: 122.5 };

/* ---------- the things you can tap at each scale ---------- */
// galactic longitude l and latitude b (°) and distance tell where each thing is as seen from here
const GALAXY_SPOTS = [
  ['Sun', 'You are here', 'Our Sun, in the Orion Arm (a smaller arm between two big ones), about 26,000 light-years from the centre. It goes round the Milky Way once every ~230 million years.', null],
  ['Sagittarius A*', 'The centre of the Milky Way', 'A supermassive black hole 4 million times the mass of the Sun, about 26,700 light-years away. Its picture was taken in 2022 by the Event Horizon Telescope.', [0, 0, 26.7]],
  ['Orion Nebula', 'A star nursery', 'A cloud of gas and dust where new stars are being born, about 1,344 light-years away. You can see it with your eyes in Orion’s sword.', [209.0, -19.4, 1.344]],
  ['Pleiades', 'A star cluster', 'The “Seven Sisters”, a cluster of young blue stars about 444 light-years away.', [166.6, -23.5, 0.444]],
  ['Crab Nebula', 'What’s left of an exploded star', 'The remains of a supernova seen from Earth in the year 1054, about 6,500 light-years away. A spinning neutron star sits in the middle.', [184.6, -5.8, 6.5]],
  ['Eagle Nebula', 'The Pillars of Creation', 'Its towering columns of gas, photographed by Hubble and Webb, are about 7,000 light-years away.', [17.0, 0.8, 7.0]],
  ['Omega Centauri', 'A globular cluster', 'About 10 million old stars in a ball, about 17,000 light-years away, above the Milky Way’s disc.', [309.1, 15.0, 17.1]],
];
const ARMS = [['Perseus Arm', 0.2], ['Scutum–Centaurus Arm', 0.2 + Math.PI / 2], ['Norma Arm', 0.2 + Math.PI], ['Sagittarius Arm', 0.2 + (3 * Math.PI) / 2]];
// the Local Group (distances in millions of light-years)
const LOCAL = [
  ['Milky Way', 'Our galaxy', 'A barred spiral galaxy about 100,000 light-years across, with 100–400 billion stars. Everything you can see in the night sky without a telescope is in it.', [0, 0, 0], 100, 'spiral'],
  ['Andromeda Galaxy (M31)', 'The nearest big galaxy', 'About 2.5 million light-years away and around 220,000 light-years across, with about a trillion stars. It is coming towards us and will merge with the Milky Way in about 4–5 billion years. You can see it with your eyes on a dark night.', [121.17, -21.57, 2.54], 220, 'spiral'],
  ['Triangulum Galaxy (M33)', 'The third big spiral', 'About 2.7 million light-years away and 60,000 light-years across.', [133.61, -31.33, 2.73], 60, 'spiral'],
  ['Large Magellanic Cloud', 'A small galaxy next to ours', 'About 160,000 light-years away; seen from the Southern Hemisphere as a cloudy patch. It goes round the Milky Way.', [280.47, -32.89, 0.163], 32, 'cloud'],
  ['Small Magellanic Cloud', 'A small galaxy next to ours', 'About 200,000 light-years away, next to the Large Magellanic Cloud in the southern sky.', [302.81, -44.33, 0.204], 19, 'cloud'],
  ['M32', 'A small galaxy by Andromeda', 'A compact elliptical galaxy right next to Andromeda, about 2.5 million light-years away.', [121.15, -21.98, 2.49], 8, 'ball'],
  ['M110', 'A small galaxy by Andromeda', 'A dwarf elliptical galaxy that goes round Andromeda, about 2.7 million light-years away.', [120.72, -21.14, 2.69], 17, 'ball'],
  ['Sagittarius Dwarf', 'Being pulled apart by the Milky Way', 'A small galaxy about 65,000 light-years away, being torn into streams of stars by our galaxy’s gravity.', [5.6, -14.2, 0.065], 10, 'ball'],
  ['Fornax Dwarf', 'A small galaxy', 'A dwarf galaxy about 460,000 light-years away that goes round the Milky Way.', [237.1, -65.7, 0.46], 6, 'ball'],
  ['Leo I', 'A small galaxy', 'A dwarf galaxy about 820,000 light-years away, one of the farthest that goes round the Milky Way.', [226.0, 49.1, 0.82], 4, 'ball'],
];
// the wider universe (millions of light-years)
const UNIVERSE = [
  ['Local Group', 'Our neighbourhood', 'The Milky Way, Andromeda, Triangulum and more than 80 small galaxies, about 10 million light-years across.', [0, 0, 0]],
  ['Virgo Cluster', 'The nearest big cluster of galaxies', 'More than 1,000 galaxies about 54 million light-years away. The Local Group is on its outskirts.', [283.8, 74.5, 54]],
  ['Great Attractor', 'A pull in space', 'A huge concentration of mass about 150–250 million light-years away that everything around us is drifting towards.', [325.3, -7.3, 220]],
  ['Coma Cluster', 'A huge cluster of galaxies', 'Over 1,000 galaxies about 320 million light-years away — where astronomers first found signs of dark matter (1933).', [58.1, 88.0, 321]],
  ['Shapley Supercluster', 'The biggest pile of galaxies nearby', 'Thousands of galaxies about 650 million light-years away.', [312.0, 30.7, 650]],
  ['Laniakea', 'Our supercluster', 'Our home supercluster: about 100,000 galaxies, roughly 520 million light-years across (named in 2014; Hawaiian for “immeasurable heaven”).', [0, 0, 0]],
  ['Edge of the observable universe', 'As far as light lets us see', 'Light from further away hasn’t had time to reach us in the universe’s 13.8 billion years. Because space has stretched, the edge is now about 46.5 billion light-years away in every direction. The glow from there is the cosmic microwave background.', [0, 0, 0]],
];
const LEVELS = [['solar', 'Solar system'], ['galaxy', 'Milky Way'], ['local', 'Local Group'], ['universe', 'Universe']];

export const space3dLab = {
  id: 'space3d', name: 'Solar system & beyond (3D)', subject: 'space', three: true,
  topic: 'the solar system, the Milky Way galaxy, the Local Group of galaxies and the large-scale structure of the universe',
  blurb: 'Fly round the planets in 3D, then zoom out to the Milky Way, our neighbour galaxies and the whole observable universe. Tap anything to learn about it.',
  words: 'space solar system planets 3d sun moon galaxy milky way andromeda universe stars astronomy zoom nebula black hole',
  icon: '<circle cx="24" cy="24" r="5"/><ellipse cx="24" cy="24" rx="19" ry="8" transform="rotate(-20 24 24)"/><circle cx="40" cy="17" r="2.5"/><circle cx="9" cy="31" r="2"/>',
  tries: ['Fly to Jupiter and find the Great Red Spot', 'Zoom out to the Milky Way and find where the Sun is', 'Find the Andromeda Galaxy — the nearest big galaxy'],
  hints: ['Tap Jupiter (the biggest planet, the 5th from the Sun). Turn it round — the spot is a giant storm in its southern half.', 'Tap “Milky Way” under Scale, or keep zooming out past Neptune. Look for “You are here”.', 'Go to the Local Group scale and look for the biggest spiral apart from ours.'],
  about: 'Solar system: the planets are where they really are on today’s date (and move as time runs), on their true elliptical orbits, from JPL’s approximate orbital elements. To fit everything on a screen, the planets are drawn much bigger than they really are, and with “Squeezed” distances the far planets are pulled in; choose “To scale” for true distances (the sizes stay enlarged — at true size every planet would be far smaller than a pixel). The planets wear real maps made from spacecraft pictures (NASA; Earth and the Moon from the three.js project) — Earth shows its city lights on the night side, its clouds and the Sun glinting on the oceans. Mercury, Venus’s cloud tops and Uranus are drawn to match photos (there’s no free full map of them), and Saturn’s rings follow their measured layout (the bright B ring, the dark Cassini Division, the A ring). The stars behind are the 9,000 brightest from the Hipparcos satellite’s star map, in their real places.\nMilky Way: a model of a barred spiral with four main arms; the Sun and the labelled objects are placed at their real directions and distances. The exact shape of our galaxy is still being measured.\nLocal Group: galaxies at their real distances and directions (measured values, rounded). Universe: the named clusters are at their real distances; the web of galaxies around them is a model of the cosmic web, not a map.\nNumbers are rounded; moon counts change as new moons are found.',
  mount({ stage, panel, api }) {
    if (!webglOk()) { stage.appendChild(el('p', 'lab-err', 'This browser can’t show 3D (WebGL is off). Try Chrome, or turn on “Use graphics acceleration” in its settings.')); return {}; }
    const loading = el('p', 'lab-loading', 'Loading 3D space…'); stage.appendChild(loading);
    let S = null, dead = false, level = 'solar', selected = null, day = today(), speed = 1, scaleMode = 'squeezed';
    const card = el('div', 'space-card'); card.hidden = true;
    const dateBox = overlay(stage, 'tl'); dateBox.classList.add('space-date');
    const zoomBox = overlay(stage, 'br');
    seg(group(panel, 'Scale'), { options: LEVELS, value: level, onChange: (v) => go(v) });
    panel.appendChild(card);
    const timeG = group(panel, 'Time');
    seg(timeG, { options: [[0, 'Pause'], [1, '1 day / s'], [7, '1 week / s'], [30, '1 month / s'], [365, '1 year / s']], value: speed, onChange: (v) => { speed = +v; } });
    button(row(timeG, 'lab-row-btns'), 'Back to today', () => { day = today(); });
    const distG = group(panel, 'Distances');
    seg(distG, { options: [['squeezed', 'Squeezed (fits)'], ['true', 'To scale']], value: scaleMode, onChange: (v) => { scaleMode = v; placeOrbits(); } });
    const outB = button(zoomBox, 'Zoom out ⤢', () => { const i = LEVELS.findIndex(([k]) => k === level); if (i < LEVELS.length - 1) go(LEVELS[i + 1][0]); });
    const inB = button(zoomBox, 'Zoom in', () => { const i = LEVELS.findIndex(([k]) => k === level); if (i > 0) go(LEVELS[i - 1][0]); });

    const groups = {}, things = {}; // level → THREE.Group; name → { obj, info }
    let THREE = null, look = null;
    stage3d(stage, { background: 0x020308, far: 2e6 }).then((st) => {
      if (dead) { st.destroy(); return; }
      S = st; THREE = S.THREE; loading.remove();
      build();
      go('solar', true);
      S.onFrame(tick);
      // scrolling out past the edge of one scale opens the next one (and in, the one before)
      S.canvas.addEventListener('wheel', (e) => {
        const d = S.camera.position.distanceTo(S.controls.target), i = LEVELS.findIndex(([k]) => k === level);
        if (e.deltaY > 0 && d >= S.controls.maxDistance * 0.97 && i < LEVELS.length - 1) go(LEVELS[i + 1][0]);
        else if (e.deltaY < 0 && d <= S.controls.minDistance * 1.05 && i > 0 && !selected) go(LEVELS[i - 1][0]);
      }, { passive: true });
    }).catch(() => { loading.textContent = 'The 3D view couldn’t load — check your internet and open this lab again.'; });

    /* ---------- building every scale ---------- */
    const dot = () => paintTexture(THREE, 64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
    let dotTex = null;
    function points(list, size, opacity = 1) { // list: [[x, y, z, r, g, b], …]
      const pos = new Float32Array(list.length * 3), col = new Float32Array(list.length * 3);
      list.forEach((p, i) => { pos.set(p.slice(0, 3), i * 3); col.set(p.slice(3, 6), i * 3); });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return new THREE.Points(g, new THREE.PointsMaterial({ size, map: dotTex || (dotTex = dot()), vertexColors: true, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    }
    const gauss = (() => { let spare = null; return () => { if (spare != null) { const s = spare; spare = null; return s; } let u, v, s; do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (!s || s >= 1); const m = Math.sqrt((-2 * Math.log(s)) / s); spare = v * m; return u * m; }; })();
    function stars(n, R) { const out = []; for (let i = 0; i < n; i++) { const v = new THREE.Vector3(gauss(), gauss(), gauss()).normalize().multiplyScalar(R * (0.6 + Math.random() * 0.4)); const t = Math.random(); out.push([v.x, v.y, v.z, 0.75 + t * 0.25, 0.8 + t * 0.15, 1]); } return points(out, R * 0.004, 0.9); }
    // galactic (l, b, distance) → position; the galaxy's centre is the origin and the Sun sits at +x
    const SUN_R = 26.7; // thousand light-years
    function galPos(l, b, d, sun = new THREE.Vector3(SUN_R, 0, 0)) { const L = (l * Math.PI) / 180, B = (b * Math.PI) / 180; return new THREE.Vector3(sun.x - d * Math.cos(B) * Math.cos(L), d * Math.sin(B), sun.z - d * Math.cos(B) * Math.sin(L)); }
    // near: its name shows only when the camera is closer than this (so labels don't pile up)
    function marker(grp, name, sub, info, pos, color = 0xffffff, size = 1, near = Infinity) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 12), new THREE.MeshBasicMaterial({ color }));
      m.position.copy(pos); grp.add(m);
      // the Milky Way has a "Sun" too: keep it apart from the solar system's Sun
      const key = things[name] && things[name].level !== grp.userData.level ? grp.userData.level + ':' + name : name;
      things[key] = { obj: m, name, sub, info, level: grp.userData.level, size };
      S.pickable(m, () => pick(key), () => grp.visible);
      S.label(m, name, { onTap: () => pick(key), show: () => grp.visible && (selected === key || S.camera.position.distanceTo(m.position) < near) });
      return m;
    }
    function build() {
      // ----- the solar system
      const sol = new THREE.Group(); sol.userData.level = 'solar'; groups.solar = sol; S.scene.add(sol);
      look = planetLook(THREE, S); S.onFrame((dt) => { if (level === 'solar') look.tick(dt); });
      look.sky().then((pts) => { if (pts) sol.add(pts); }); // the real night sky
      sol.add(new THREE.AmbientLight(0xffffff, 0.07)); // space is dark: the night side of a planet is too
      sol.add(new THREE.PointLight(0xffffff, 3, 0, 0));
      const sunTex = paintTexture(THREE, 512, 256, (g, w, h) => { const n = noise2(3); const img = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = n(x / 18, y / 18, 4); const i = (y * w + x) * 4; img.data[i] = 255; img.data[i + 1] = 150 + v * 90; img.data[i + 2] = 40 + v * 50; img.data[i + 3] = 255; } g.putImageData(img, 0, 0); });
      const sun = new THREE.Mesh(new THREE.SphereGeometry(1.7, 64, 48), new THREE.MeshBasicMaterial({ map: sunTex }));
      sol.add(sun);
      look.sun(sun);
      things.Sun = { obj: sun, name: 'Sun', sub: 'Our star', size: 1.7, level: 'solar', info: () => [['What it is', 'A yellow dwarf star — a ball of hot gas (mostly hydrogen and helium) that makes energy by nuclear fusion'], ['Diameter', '1,392,700 km (109 Earths across)'], ['Mass', '99.86% of everything in the solar system'], ['Surface', 'about 5,500 °C (the core: about 15 million °C)'], ['Light to Earth', 'about 8 minutes 20 seconds'], ['Age', 'about 4.6 billion years']] };
      S.pickable(sun, () => pick('Sun')); S.label(sun, 'Sun', { onTap: () => pick('Sun'), offset: new THREE.Vector3(0, -2.3, 0), show: () => sol.visible });
      const tex = {
        Mercury: (n) => (x, y) => { const v = n(x * 8, y * 8, 5); const c = 95 + v * 90; return [c, c * 0.97, c * 0.93]; },
        Venus: (n) => (x, y) => { const v = n(x * 3 + n(x * 6, y * 6) * 2, y * 9, 4); return [215 + v * 35, 175 + v * 40, 105 + v * 40]; },
        Earth: (n) => (x, y) => { const lat = Math.abs(y - 0.5) * 2; const v = n(x * 5, y * 5, 5); if (lat > 0.86) return [235, 240, 245]; if (v > 0.53) return v > 0.66 ? [150, 128, 90] : [70 + v * 60, 130 + v * 40, 60]; const cl = n(x * 9 + 7, y * 9, 4); return cl > 0.62 ? [225, 230, 236] : [25, 70 + v * 60, 150 + v * 60]; },
        Mars: (n) => (x, y) => { const lat = Math.abs(y - 0.5) * 2; const v = n(x * 6, y * 6, 5); if (lat > 0.9) return [240, 235, 230]; return [170 + v * 60, 75 + v * 40, 40 + v * 20]; },
        Jupiter: (n) => (x, y) => { const band = Math.sin(y * 48 + n(x * 4, y * 4) * 3) + 0.4 * Math.sin(y * 110); let c = band > 0 ? [222, 196, 160] : [170, 120, 85]; const dx = (x - 0.62) * 2.2, dy = (y - 0.62) * 9; if (dx * dx + dy * dy < 1) c = [190, 85, 60]; return c.map((k) => k + n(x * 30, y * 10) * 20 - 10); },
        Saturn: (n) => (x, y) => { const band = Math.sin(y * 28 + n(x * 3, y * 3) * 2); return band > 0 ? [230, 210, 160] : [200, 175, 120]; },
        Uranus: (n) => (x, y) => { const v = n(x * 2, y * 12, 3); return [160 + v * 25, 215 + v * 20, 220 + v * 15]; },
        Neptune: (n) => (x, y) => { const v = n(x * 3, y * 14, 4); const dx = (x - 0.3) * 4, dy = (y - 0.6) * 10; return dx * dx + dy * dy < 1 ? [30, 40, 110] : [55 + v * 30, 90 + v * 40, 205 + v * 40]; },
      };
      PLANETS.forEach((p, i) => {
        const name = p[0], n = noise2(i + 5), f = tex[name](n);
        const map = paintTexture(THREE, 512, 256, (g, w, h) => { const img = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, gg, b] = f(x / w, y / h); const k = (y * w + x) * 4; img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255; } g.putImageData(img, 0, 0); });
        const r = 0.18 + 0.32 * (p[6] / 12756) ** 0.5;
        const pivot = new THREE.Group(); sol.add(pivot);
        const tilt = new THREE.Group(); tilt.rotation.z = (MORE[name][2] * Math.PI) / 180; pivot.add(tilt);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 72, 48), new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0 }));
        tilt.add(ball);
        look.dress(name, ball, r); // the real map (and its air) replaces the painted one when it arrives
        if (name === 'Saturn') look.saturnRings(ball, r, tilt);
        if (name === 'Uranus') { // thin, dark rings
          const ringTex = paintTexture(THREE, 256, 4, (g, w) => { for (let x = 0; x < w; x++) { const t = x / w, a = Math.sin(t * 40) > 0.75 ? 0.22 : 0; g.fillStyle = `rgba(190,200,205,${a})`; g.fillRect(x, 0, 1, 4); } });
          const inner = r * 1.6, outer = r * 2.0, geo = new THREE.RingGeometry(inner, outer, 96, 1);
          const pos = geo.attributes.position, uv = geo.attributes.uv; for (let k = 0; k < pos.count; k++) { const d = Math.hypot(pos.getX(k), pos.getY(k)); uv.setXY(k, (d - inner) / (outer - inner), 0.5); }
          const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
          ring.rotation.x = Math.PI / 2; tilt.add(ring);
        }
        if (name === 'Earth') { // the Moon (its distance is enlarged too)
          const moon = new THREE.Mesh(new THREE.SphereGeometry(r * 0.27, 48, 32), new THREE.MeshStandardMaterial({ map: paintTexture(THREE, 256, 128, (g, w, h) => { const nn = noise2(42); const img = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = nn(x / 14, y / 14, 5); const c = 110 + v * 100; const k = (y * w + x) * 4; img.data[k] = c; img.data[k + 1] = c; img.data[k + 2] = c; img.data[k + 3] = 255; } g.putImageData(img, 0, 0); }), roughness: 1 }));
          pivot.add(moon); pivot.userData.moon = moon; look.dress('Moon', moon, r * 0.27);
          things.Moon = { obj: moon, name: 'Moon', sub: 'Earth’s moon', size: r * 0.27, level: 'solar', info: () => [['Diameter', '3,474 km (about a quarter of Earth’s)'], ['Distance from Earth', 'about 384,400 km (light takes 1.3 s)'], ['One orbit', '27.3 days (29.5 days from new moon to new moon)'], ['Fact', 'The same side always faces Earth, because it spins exactly once each orbit.'], ['Visited', '12 people walked on it (1969–1972)']] };
          S.pickable(moon, () => pick('Moon'), () => sol.visible); S.label(moon, 'Moon', { onTap: () => pick('Moon'), className: 'small', show: () => sol.visible && S.camera.position.distanceTo(pivot.position) < 25 });
        }
        const orbit = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x8a90a8, transparent: true, opacity: 0.35 }));
        sol.add(orbit);
        things[name] = { obj: ball, pivot, orbit, name, p, size: r, level: 'solar', sub: p[10] === 'rocky' ? 'Rocky planet' : p[10] === 'gas giant' ? 'Gas giant' : 'Ice giant', info: () => planetFacts(p) };
        S.pickable(ball, () => pick(name), () => sol.visible);
        S.label(ball, name, { onTap: () => pick(name), offset: new THREE.Vector3(0, r * 1.6, 0), show: () => sol.visible });
      });
      // the asteroid belt and the Kuiper belt (with Pluto)
      const belt = (a0, a1, n, c, ref) => { const out = []; for (let k = 0; k < n; k++) { const a = a0 + Math.random() * (a1 - a0), th = Math.random() * Math.PI * 2; out.push([a, th, (Math.random() - 0.5) * 0.08 * a, ...c]); } const pts = points(out.map(() => [0, 0, 0, ...c]), ref, 0.7); pts.userData.belt = out; sol.add(pts); return pts; };
      groups.solar.userData.belts = [belt(2.2, 3.3, 1500, [0.75, 0.7, 0.62], 0.12), belt(30, 50, 2000, [0.55, 0.62, 0.8], 0.25)];
      const pluto = new THREE.Mesh(new THREE.SphereGeometry(0.16, 40, 28), new THREE.MeshStandardMaterial({ color: 0xc9b39a, roughness: 1 }));
      sol.add(pluto); look.dress('Pluto', pluto, 0.16);
      things.Pluto = { obj: pluto, name: 'Pluto', sub: 'Dwarf planet', size: 0.16, level: 'solar', pluto: true, info: () => [['What it is', 'A dwarf planet in the Kuiper Belt (called a planet until 2006)'], ['Diameter', '2,377 km (smaller than our Moon)'], ['One orbit', '248 years'], ['Moons', '5 (the biggest is Charon)'], ['Fact', 'New Horizons flew past in 2015 and found a giant heart-shaped plain of nitrogen ice.']] };
      S.pickable(pluto, () => pick('Pluto'), () => sol.visible); S.label(pluto, 'Pluto', { onTap: () => pick('Pluto'), className: 'small', show: () => sol.visible });
      placeOrbits();

      // ----- the Milky Way (1 unit = 1,000 light-years)
      const gal = new THREE.Group(); gal.userData.level = 'galaxy'; groups.galaxy = gal; S.scene.add(gal);
      gal.add(stars(1500, 4000));
      const gp = [];
      const R = 50, pitch = (12.5 * Math.PI) / 180;
      for (let k = 0; k < 70000; k++) {
        const arm = k % 4, r = 3 + Math.pow(Math.random(), 0.8) * R, th = ARMS[arm][1] + Math.log(r / 3) / Math.tan(pitch) + gauss() * (0.18 + 6 / r);
        const x = r * Math.cos(th), z = r * Math.sin(th), y = gauss() * (0.25 + 1.2 * Math.exp(-r / 6));
        const t = Math.min(1, r / R), pink = Math.random() < 0.04;
        gp.push([x, y, z, pink ? 1 : 0.95 - t * 0.35, pink ? 0.55 : 0.85 - t * 0.15, pink ? 0.7 : 0.7 + t * 0.3]);
      }
      for (let k = 0; k < 18000; k++) { const v = new THREE.Vector3(gauss() * 4.5, gauss() * 2.2, gauss() * 2.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.47); gp.push([v.x, v.y, v.z, 1, 0.85, 0.6]); } // the bulge and the bar
      for (let k = 0; k < 2500; k++) { const th = Math.PI * 0.03 + gauss() * 0.18, r = SUN_R + gauss() * 1.2; gp.push([r * Math.cos(th), gauss() * 0.3, r * Math.sin(th), 0.85, 0.9, 1]); } // the Orion spur
      const disc = points(gp, 0.55, 0.85); gal.add(disc);
      ARMS.forEach(([name, a0]) => { const r = 34, th = a0 + Math.log(r / 3) / Math.tan(pitch); const o = new THREE.Object3D(); o.position.set(r * Math.cos(th), 1.5, r * Math.sin(th)); gal.add(o); S.label(o, name, { className: 'faint', show: () => gal.visible }); });
      const sunAt = galPos(0, 0, 0);
      GALAXY_SPOTS.forEach(([name, sub, text, lbd]) => marker(gal, name, sub, () => [['What it is', sub], ['About it', text], ...(lbd && name !== 'Sagittarius A*' ? [['Distance from the Sun', `about ${num(lbd[2] * 1000, 3)} light-years`]] : [])], lbd ? galPos(...lbd) : sunAt, name === 'Sun' ? 0xffd27a : name === 'Sagittarius A*' ? 0xffffff : 0x9fd0ff, name === 'Sun' ? 0.5 : 0.35, name === 'Sun' || name === 'Sagittarius A*' ? Infinity : 45));

      // ----- the Local Group (1 unit = 10,000 light-years)
      const loc = new THREE.Group(); loc.userData.level = 'local'; groups.local = loc; S.scene.add(loc);
      loc.add(stars(1500, 20000));
      LOCAL.forEach(([name, sub, text, lbd, size, kind], gi) => {
        const pos = gi === 0 ? new THREE.Vector3() : galPos(lbd[0], lbd[1], lbd[2] * 100, new THREE.Vector3(SUN_R / 10, 0, 0));
        const rr = size / 20, pts = [];
        const nPts = kind === 'spiral' ? 9000 : kind === 'cloud' ? 2500 : 1200;
        for (let k = 0; k < nPts; k++) {
          if (kind === 'spiral') { const arm = k % 2, r = 0.2 + Math.random() * rr, th = arm * Math.PI + Math.log(1 + r * 3) * 2.4 + gauss() * 0.3; pts.push([r * Math.cos(th), gauss() * rr * 0.03, r * Math.sin(th), 0.9, 0.88, 1]); }
          else if (kind === 'cloud') pts.push([gauss() * rr * 0.6, gauss() * rr * 0.35, gauss() * rr * 0.45, 0.8, 0.85, 1]);
          else pts.push([gauss() * rr * 0.4, gauss() * rr * 0.3, gauss() * rr * 0.3, 1, 0.9, 0.75]);
        }
        const blob = points(pts, Math.max(0.1, rr * 0.06), 0.9);
        blob.position.copy(pos);
        if (gi) blob.rotation.set(Math.random() * 2, Math.random() * 2, 0);
        loc.add(blob);
        marker(loc, name, sub, () => [['What it is', sub], ['About it', text], ...(gi ? [['Distance', lbd[2] >= 1 ? `about ${num(lbd[2], 3)} million light-years` : `about ${Math.round(lbd[2] * 1000).toLocaleString()} thousand light-years`]] : []), ['Size', `about ${size.toLocaleString()},000 light-years across`]], pos, gi === 0 ? 0xffd27a : 0xcfe2ff, Math.max(0.6, rr * 0.12), size >= 30 ? Infinity : 160);
      });

      // ----- the universe (1 unit = 1 million light-years)
      const uni = new THREE.Group(); uni.userData.level = 'universe'; groups.universe = uni; S.scene.add(uni);
      const nodes = UNIVERSE.filter((u) => u[0] !== 'Laniakea' && u[0] !== 'Edge of the observable universe').map((u) => galPos(u[3][0], u[3][1], u[3][2], new THREE.Vector3()));
      for (let k = 0; k < 60; k++) nodes.push(new THREE.Vector3(gauss(), gauss(), gauss()).normalize().multiplyScalar(80 + Math.random() * 900));
      const web = [];
      nodes.forEach((a, i) => { // filaments to the nearest few nodes, with galaxies strung along them
        nodes.map((b, j) => [b, a.distanceTo(b), j]).filter(([, d, j]) => j !== i).sort((x, y) => x[1] - y[1]).slice(0, 3).forEach(([b]) => {
          for (let k = 0; k < 220; k++) { const t = Math.random(), p = a.clone().lerp(b, t).add(new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(6 + a.distanceTo(b) * 0.02)); web.push([p.x, p.y, p.z, 0.7, 0.75, 1]); }
        });
        for (let k = 0; k < 160; k++) { const p = a.clone().add(new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(10)); web.push([p.x, p.y, p.z, 1, 0.9, 0.8]); } // a cluster at each knot
      });
      uni.add(points(web, 3.2, 0.75));
      UNIVERSE.forEach(([name, sub, text, lbd]) => {
        const pos = name === 'Laniakea' ? new THREE.Vector3(0, 260, 0) : name === 'Edge of the observable universe' ? new THREE.Vector3(0, 0, -1400) : galPos(lbd[0], lbd[1], lbd[2], new THREE.Vector3());
        marker(uni, name, sub, () => [['What it is', sub], ['About it', text], ...(lbd[2] ? [['Distance', `about ${big(lbd[2] * 1e6)} light-years`]] : []), ...(name === 'Edge of the observable universe' ? [['In this picture', 'drawn far closer than it really is — at true scale it would be about 30 times farther out than Laniakea’s ring is wide']] : [])], pos, name === 'Local Group' ? 0xffd27a : 0xffffff, name === 'Local Group' ? 6 : 5);
      });
      const lan = new THREE.Mesh(new THREE.SphereGeometry(260, 48, 24), new THREE.MeshBasicMaterial({ color: 0x6f8fff, wireframe: true, transparent: true, opacity: 0.06 }));
      uni.add(lan);
      const edge = new THREE.Mesh(new THREE.SphereGeometry(1400, 64, 32), new THREE.MeshBasicMaterial({ color: 0xff9d5c, transparent: true, opacity: 0.07, side: THREE.BackSide }));
      uni.add(edge);
    }

    /* ---------- the solar system moves with time ---------- */
    const squeeze = (au) => (scaleMode === 'true' ? au * 2.3 : 7 * Math.pow(au, 0.6));
    function posOf(p, d) { const q = planetAt(p, d), r = Math.hypot(q.x, q.y), k = squeeze(r) / r; return new THREE.Vector3(q.x * k, 0, -q.y * k); }
    function placeOrbits() {
      if (!THREE) return;
      PLANETS.forEach((p) => {
        const t = things[p[0]], P = periodDays(p), pts = [];
        for (let k = 0; k <= 240; k++) pts.push(posOf(p, day + (k / 240) * P));
        t.orbit.geometry.dispose(); t.orbit.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      });
      const sun = things.Sun.obj; sun.scale.setScalar(scaleMode === 'true' ? 0.35 : 1);
      const [ast, kui] = groups.solar.userData.belts;
      [[ast, 0.12], [kui, 0.25]].forEach(([b, s]) => { const pos = b.geometry.attributes.position; b.userData.belt.forEach(([a, th, y], k) => { const r = squeeze(a); pos.setXYZ(k, r * Math.cos(th), y * (r / a), r * Math.sin(th)); }); pos.needsUpdate = true; b.material.size = s * (scaleMode === 'true' ? 1.6 : 1); });
      placePlanets();
      if (selected && things[selected] && things[selected].level === 'solar') follow(true);
    }
    function placePlanets() {
      PLANETS.forEach((p) => { const t = things[p[0]]; t.pivot.position.copy(posOf(p, day)); });
      const moon = things.Moon.obj, e = things.Earth, ang = ((day % 27.32) / 27.32) * Math.PI * 2;
      moon.position.set(Math.cos(ang) * e.size * 3.2, 0, -Math.sin(ang) * e.size * 3.2);
      const pl = (day / 365.25 / 248) * Math.PI * 2 + 3.9, pr = squeeze(39.5);
      things.Pluto.obj.position.set(pr * Math.cos(pl), pr * 0.15 * Math.sin(pl * 1.3), -pr * Math.sin(pl));
    }
    let lastOrbitDay = day;
    function tick(dt) {
      if (level === 'solar') {
        day += speed * dt;
        placePlanets();
        PLANETS.forEach((p) => { const t = things[p[0]]; t.obj.rotation.y += (dt * speed * 24 * Math.PI * 2) / Math.max(10, Math.abs(p[7])) * Math.sign(p[7]) * 0.02 + dt * 0.05; });
        things.Sun.obj.rotation.y += dt * 0.02;
        if (Math.abs(day - lastOrbitDay) > 3000) { lastOrbitDay = day; placeOrbits(); }
        if (selected && things[selected].level === 'solar') follow(false);
        const d = new Date(J2000 + day * DAY);
        dateBox.textContent = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + (Math.abs(day - today()) < 1 ? ' · today' : '');
      } else dateBox.textContent = { galaxy: 'The Milky Way · 1 grid = 1,000 light-years', local: 'The Local Group · millions of light-years', universe: 'The universe around us · billions of light-years' }[level];
      groups.galaxy.rotation.y += dt * 0.004 * (level === 'galaxy' ? 1 : 0);
    }
    // keep the camera on a moving planet
    let lastTarget = null;
    function follow(jump) {
      const t = things[selected], at = new THREE.Vector3(); t.obj.getWorldPosition(at);
      if (lastTarget && !jump) { const d = at.clone().sub(lastTarget); S.camera.position.add(d); S.controls.target.add(d); }
      lastTarget = at;
    }

    /* ---------- moving between scales, and picking things ---------- */
    const CAM = {
      solar: { pos: [0, 38, 72], min: 0.4, max: 260, near: 0.01 },
      galaxy: { pos: [0, 70, 85], min: 2, max: 400, near: 0.1 },
      local: { pos: [0, 220, 360], min: 3, max: 2600, near: 0.5 },
      universe: { pos: [0, 900, 1500], min: 20, max: 4500, near: 5 },
    };
    function go(lv, first) {
      if (!S) { level = lv; return; }
      level = lv; selected = null; lastTarget = null; card.hidden = true;
      Object.entries(groups).forEach(([k, g]) => { g.visible = k === lv; });
      const c = CAM[lv];
      S.controls.minDistance = c.min; S.controls.maxDistance = c.max;
      S.camera.near = c.near; S.camera.far = c.max * 40; S.camera.updateProjectionMatrix();
      const from = new THREE.Vector3(...c.pos).multiplyScalar(first ? 1 : 1.0);
      S.camera.position.copy(from.clone().multiplyScalar(0.4)); S.controls.target.set(0, 0, 0);
      S.flyTo(new THREE.Vector3(), from.length(), { dir: from.clone(), dur: first ? 1.6 : 1.1 });
      timeG.hidden = lv !== 'solar'; distG.hidden = lv !== 'solar';
      outB.hidden = lv === 'universe'; inB.hidden = lv === 'solar';
      panel.querySelectorAll('.lab-seg button').forEach((b) => { if (LEVELS.some(([k]) => k === b.dataset.v)) b.setAttribute('aria-pressed', String(b.dataset.v === lv)); });
      if (lv === 'galaxy') S.controls.autoRotate = false;
    }
    function pick(name) {
      const t = things[name]; if (!t) return;
      selected = name; lastTarget = null;
      const at = new THREE.Vector3(); t.obj.getWorldPosition(at);
      const dist = t.level === 'solar' ? Math.max(1.2, t.size * 6) : t.level === 'galaxy' ? (t.name === 'Sun' || t.name === 'Sagittarius A*' ? 22 : 8) : t.level === 'local' ? Math.max(12, t.size * 30) : 120;
      S.flyTo(at, dist, { dur: 1, done: () => { lastTarget = null; if (t.level === 'solar') follow(true); } });
      const info = t.info();
      card.hidden = false;
      card.innerHTML = `<h3>${esc(t.name)}</h3><p class="space-sub">${esc(t.sub || '')}</p>`;
      const st = stats(card); st.set(info);
      const back = el('button', 'lab-btn', 'See everything'); back.type = 'button'; back.addEventListener('click', () => go(level)); card.appendChild(back);
      if (name === 'Jupiter') api.check(0);
      if (t.name === 'Sun' && t.level === 'galaxy') api.check(1);
      if (/Andromeda/.test(name)) api.check(2);
    }
    function planetFacts(p) {
      const [name, a, e, , , , diam, dayH, moons, temp] = p, [gr, mass] = MORE[name];
      const now = planetAt(p, day), earth = planetAt(PLANETS[2], day), fromEarth = Math.hypot(now.x - earth.x, now.y - earth.y);
      return [['Diameter', `${diam.toLocaleString()} km${name === 'Earth' ? '' : ` (${num(diam / 12756, 2)} × Earth)`}`],
        ['Distance from the Sun now', `${num(now.r, 3)} AU = ${big(now.r * AU_KM)} km`],
        ...(name === 'Earth' ? [] : [['Distance from Earth now', `${big(fromEarth * AU_KM)} km (light takes ${num((fromEarth * AU_KM) / 299792.458 / 60, 3)} min)`]]),
        ['One year (orbit)', `${num(periodDays(p), 4)} Earth days${a > 1.5 ? ` (${num(periodDays(p) / 365.25, 3)} years)` : ''}`],
        ['One day (spin)', `${num(Math.abs(dayH), 3)} hours${dayH < 0 ? ' — backwards' : ''}`],
        ['Moons', moons === 0 ? 'none' : name === 'Earth' ? '1 (the Moon)' : `${moons} known`],
        ['Gravity', `${gr} m/s² (${num(gr / 9.81, 2)} × Earth’s)`], ['Mass', `${num(mass, 3)} × Earth`], ['Average temperature', `${temp} °C`], ['Fact', MORE[name][3]]];
    }

    return {
      state: () => {
        const sc = LEVELS.find(([k]) => k === level)[1];
        if (!selected) return `looking at the ${sc} scale in 3D${level === 'solar' ? ` on ${new Date(J2000 + day * DAY).toDateString()}` : ''}`;
        const t = things[selected];
        return `looking at ${t.name} (${t.sub}) in the ${sc} view: ${t.info().map(([k, v]) => `${k}: ${v}`).join('; ')}`;
      },
      destroy: () => { dead = true; if (S) S.destroy(); },
    };
  },
};

/* How the 3D solar system looks: real maps of the planets (NASA and three.js, public domain —
   see labs/CREDITS.md), Earth with its night-side city lights, moving clouds and oceans that
   catch the sun, a thin glow of air round the planets that have one, a Sun whose surface
   boils, Saturn's rings as they really are (with the planet's shadow across them) and the
   real night sky. Until a picture arrives the painted one stays, so nothing waits on the
   network. Used by space3d.js. */
const at = (f) => new URL('./tex/' + f, import.meta.url).href;
const MAPS = { Mercury: 'mercury.webp', Venus: 'venus.webp', Mars: 'mars.webp', Jupiter: 'jupiter.webp', Saturn: 'saturn.webp', Uranus: 'uranus.webp', Neptune: 'neptune.webp', Moon: 'moon.webp', Pluto: 'pluto.webp' };
// the glow of each planet's air: colour, strength
const AIR = { Venus: [[1.0, 0.86, 0.6], 1.1], Earth: [[0.35, 0.62, 1.0], 1.0], Mars: [[1.0, 0.64, 0.48], 0.35], Jupiter: [[1.0, 0.9, 0.76], 0.12], Saturn: [[1.0, 0.92, 0.75], 0.12], Uranus: [[0.62, 0.92, 1.0], 0.3], Neptune: [[0.45, 0.62, 1.0], 0.3] };
const RIM = { Earth: 1, Venus: 0.7 }; // a bright edge of air you can see on the planet itself
// Saturn's rings, in Saturn radii (the picture runs from the inner edge to the outer)
const RING_IN = 1.11, RING_OUT = 2.33;

// three.js's own pieces, so the shaders follow the renderer's colour handling
const VERT = `varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vP;
void main() { vUv = uv; vP = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const END = `#include <tonemapping_fragment>
#include <colorspace_fragment>`;

// Earth: daylight, city lights on the night side, clouds, the sun's glint on the sea, blue air at the edge
const EARTH_FRAG = `uniform sampler2D uDay; uniform sampler2D uNight; uniform sampler2D uClouds; uniform sampler2D uOcean; uniform float uShift;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 N = normalize(vN), L = normalize(-vW), V = normalize(cameraPosition - vW);
  float nl = dot(N, L), lit = smoothstep(-0.12, 0.25, nl), diff = max(nl, 0.0);
  vec3 day = texture2D(uDay, vUv).rgb, night = texture2D(uNight, vUv).rgb;
  float cloud = texture2D(uClouds, vUv + vec2(uShift, 0.0)).r, ocean = texture2D(uOcean, vUv).r;
  vec3 col = day * (diff * 1.3 + 0.025);
  vec3 H = normalize(L + V);
  col += vec3(1.0, 0.9, 0.75) * pow(max(dot(N, H), 0.0), 70.0) * ocean * (1.0 - cloud) * lit * 1.1;
  col = mix(col, vec3(diff * 1.2 + 0.02), cloud * 0.9);
  col += night * vec3(1.0, 0.82, 0.55) * pow(1.0 - lit, 2.0) * (1.0 - cloud) * 1.8;
  col += vec3(0.32, 0.58, 1.0) * pow(1.0 - max(dot(N, V), 0.0), 3.0) * (lit * 0.9 + 0.04);
  gl_FragColor = vec4(col, 1.0);
  ${END}
}`;

// the Sun: boiling cells of hot gas (granulation), a few dark spots, darker towards the edge
const NOISE = `float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }`;
const SUN_FRAG = `uniform float uTime; varying vec3 vN; varying vec3 vW; varying vec3 vP;
${NOISE}
void main() {
  vec3 p = normalize(vP);
  float big = fbm(p * 7.0 + vec3(0.0, uTime * 0.04, uTime * 0.03));
  float cells = fbm(p * 34.0 + vec3(uTime * 0.12, 0.0, -uTime * 0.1));
  float spots = smoothstep(0.7, 0.78, fbm(p * 3.2 + 11.0)) * smoothstep(0.8, 0.3, abs(p.y));
  float mu = max(dot(normalize(vN), normalize(cameraPosition - vW)), 0.0);
  float heat = clamp(big * 0.55 + cells * 0.75 - 0.15, 0.0, 1.0);
  vec3 col = mix(vec3(0.85, 0.28, 0.03), vec3(1.0, 0.78, 0.36), heat);
  col *= (0.38 + 0.62 * pow(mu, 0.6)) * 1.05 * (1.0 - spots * 0.7);
  gl_FragColor = vec4(col, 1.0);
  ${END}
}`;

// the air: a soft glow just outside the planet's edge, brighter on its sunny side
const AIR_FRAG = `uniform vec3 uColor; uniform float uPower; uniform float uEdge; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
  float x = clamp(-dot(N, V) / uEdge, 0.0, 1.0);
  float sun = mix(0.12, 1.0, smoothstep(-0.35, 0.5, dot(N, normalize(-vW))));
  gl_FragColor = vec4(uColor * pow(x, 3.0) * sun * uPower, 1.0);
  ${END}
}`;
// and a thin bright rim on the planet itself
const RIM_FRAG = `uniform vec3 uColor; uniform float uPower; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
  float sun = smoothstep(-0.25, 0.5, dot(N, normalize(-vW)));
  gl_FragColor = vec4(uColor * pow(1.0 - max(dot(N, V), 0.0), 4.0) * sun * uPower * 0.8, 1.0);
  ${END}
}`;

// Saturn's rings: the real layout of bright and dark rings, lit by the Sun, with Saturn's shadow across them
const RING_VERT = `varying vec3 vW; varying vec2 vP;
void main() { vP = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const RING_FRAG = `uniform sampler2D uRing; uniform vec3 uCenter; uniform float uR; uniform float uRw; uniform float uIn; uniform float uOut; varying vec3 vW; varying vec2 vP;
void main() {
  float r = length(vP) / uR;
  if (r < uIn || r > uOut) discard;
  vec4 c = texture2D(uRing, vec2((r - uIn) / (uOut - uIn), 0.5));
  vec3 L = normalize(-vW), oc = vW - uCenter;
  float b = dot(oc, L), d = b * b - (dot(oc, oc) - uRw * uRw * 0.995);
  float shade = (d > 0.0 && -b - sqrt(d) > 0.0) ? 0.06 : 1.0;
  gl_FragColor = vec4(c.rgb * vec3(0.92, 0.86, 0.74) * shade, c.a);
  ${END}
}`;

export function planetLook(THREE, S) {
  const loader = new THREE.TextureLoader(), aniso = Math.min(8, S.renderer.capabilities.getMaxAnisotropy());
  const load = (file, color = true) => new Promise((res) => loader.load(at(file), (t) => { if (color) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; res(t); }, undefined, () => res(null)));
  const live = [];
  let time = 0;

  function air(name, ball, r) {
    const a = AIR[name]; if (!a) return;
    const [rgb, power] = a, color = new THREE.Color(...rgb);
    const R = 1.06, glow = new THREE.Mesh(new THREE.SphereGeometry(r * R, 48, 32), new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: AIR_FRAG, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: color }, uPower: { value: power }, uEdge: { value: Math.sqrt(1 - 1 / (R * R)) } },
    }));
    glow.raycast = () => {}; // taps go to the planet
    ball.add(glow);
    if (!RIM[name]) return;
    const rim = new THREE.Mesh(new THREE.SphereGeometry(r * 1.004, 48, 32), new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: RIM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: color }, uPower: { value: RIM[name] } },
    }));
    rim.raycast = () => {}; ball.add(rim);
  }

  return {
    // put the real map on a planet (or a moon), its air round it, and for Earth the whole Earth shader
    dress(name, ball, r) {
      air(name, ball, r);
      if (name === 'Earth') {
        Promise.all([load('earth-day.webp'), load('earth-night.webp'), load('earth-clouds.webp', false), load('earth-ocean.webp', false)]).then(([day, night, clouds, ocean]) => {
          if (!day || !night || !clouds || !ocean) return;
          clouds.wrapS = THREE.RepeatWrapping;
          const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: EARTH_FRAG, uniforms: { uDay: { value: day }, uNight: { value: night }, uClouds: { value: clouds }, uOcean: { value: ocean }, uShift: { value: 0 } } });
          const old = ball.material; ball.material = m; old.map?.dispose(); old.dispose();
          live.push((dt) => { m.uniforms.uShift.value = (m.uniforms.uShift.value + dt * 0.0016) % 1; });
        });
        return;
      }
      const file = MAPS[name]; if (!file) return;
      Promise.all([load(file), name === 'Mercury' ? load('mercury-bump.webp', false) : null]).then(([map, bump]) => {
        if (!map) return;
        const m = ball.material, old = m.map;
        m.map = map; m.color.set(0xffffff); m.roughness = 1; m.metalness = 0;
        if (bump) { m.bumpMap = bump; m.bumpScale = 3; }
        m.needsUpdate = true; old?.dispose();
      });
    },
    // the Sun's surface, and its glow
    sun(mesh) {
      const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SUN_FRAG, uniforms: { uTime: { value: 0 } } });
      const old = mesh.material; mesh.material = m; old.map?.dispose(); old.dispose();
      live.push(() => { m.uniforms.uTime.value = time; });
      const halo = (stops, scale, color, opacity) => {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
        stops.forEach(([k, a]) => gr.addColorStop(k, `rgba(255,255,255,${a})`));
        g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
        s.scale.setScalar(scale); s.raycast = () => {}; mesh.add(s);
      };
      halo([[0, 1], [0.3, 0.9], [0.34, 0.45], [0.5, 0.12], [1, 0]], 5.6, 0xffc070, 0.75); // the corona close in
      halo([[0, 0.8], [0.15, 0.35], [0.4, 0.07], [1, 0]], 20, 0xff8a30, 0.5); // the wide glow
    },
    // Saturn's rings (replaces the painted ones)
    saturnRings(ball, r, tilt) {
      const geo = new THREE.RingGeometry(r * RING_IN, r * RING_OUT, 160, 1);
      const m = new THREE.ShaderMaterial({
        vertexShader: RING_VERT, fragmentShader: RING_FRAG, side: THREE.DoubleSide, transparent: true, depthWrite: false,
        uniforms: { uRing: { value: null }, uCenter: { value: new THREE.Vector3() }, uR: { value: r }, uRw: { value: r }, uIn: { value: RING_IN }, uOut: { value: RING_OUT } },
      });
      const ring = new THREE.Mesh(geo, m); ring.rotation.x = Math.PI / 2; ring.visible = false;
      tilt.add(ring);
      load('saturn-ring.png').then((t) => { if (t) { m.uniforms.uRing.value = t; ring.visible = true; } });
      live.push(() => { ball.getWorldPosition(m.uniforms.uCenter.value); m.uniforms.uRw.value = r * ball.getWorldScale(new THREE.Vector3()).x; });
      return ring;
    },
    // the real night sky: the 9,000 brightest stars from the Hipparcos star map, sharp at any zoom
    sky() {
      return fetch(at('stars.bin')).then((r) => (r.ok ? r.arrayBuffer() : null)).then((buf) => {
        if (!buf) return null;
        const d = new DataView(buf), n = buf.byteLength / 8, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const o = i * 8, phi = (d.getUint16(o, true) / 65535 - 0.5) * Math.PI * 2, th = (d.getUint16(o + 2, true) / 65535 - 0.5) * Math.PI, b = d.getUint8(o + 4) / 255;
          pos.set([Math.cos(th) * Math.cos(phi) * 3000, Math.sin(th) * 3000, Math.cos(th) * Math.sin(phi) * 3000], i * 3);
          col.set([d.getUint8(o + 5) / 200, d.getUint8(o + 6) / 200, d.getUint8(o + 7) / 200].map((c) => Math.min(1, c) * (0.25 + b * 0.85)), i * 3);
          size[i] = 1.1 + b * b * 3.2;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('size', new THREE.BufferAttribute(size, 1));
        const pts = new THREE.Points(g, new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPx: { value: S.renderer.getPixelRatio() } },
          vertexShader: 'attribute float size; varying vec3 vC; uniform float uPx; void main() { vC = color; gl_PointSize = size * uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: `varying vec3 vC;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0, a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(vC * a * a, 1.0);
  ${END}
}`,
          vertexColors: true,
        }));
        pts.frustumCulled = false; pts.renderOrder = -1; pts.raycast = () => {};
        live.push(() => { pts.position.copy(S.camera.position); }); // always infinitely far away
        return pts;
      });
    },
    tick(dt) { time += dt; live.forEach((f) => f(dt)); },
  };
}

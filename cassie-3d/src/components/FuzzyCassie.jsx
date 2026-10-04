import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/* Cassie as a little needle-felted creature. The fuzz is "shell" fur: the body is
   drawn several times, each shell pushed a little further out along its normals,
   and a per-strand hash keeps only the strands that reach that far — so the
   silhouette is soft and fibrous, not a smooth ball.

   Outfits (window.CassieMascot.setOutfit):
     classic   — red felt blob (tinted to the student's favourite colour)
     professor — grey, beret, wire glasses, black suit & tie   (research / web)
     graduate  — grey, mortarboard & tassel, maroon gown        (reviewers / quizzes)
     coder     — navy, thick black glasses, a floating { } hologram (code)
     heart     — a pink felt heart with round glasses           (heart-to-heart talks) */

const lerp = THREE.MathUtils.lerp;

/* ---------------- fur ---------------- */
const FUR_VERT = /* glsl */ `
uniform float uLayer; uniform float uLen;
varying vec3 vN; varying vec3 vV; varying vec3 vObj; varying vec3 vON;
void main() {
  vObj = position; vON = normal;
  vec3 p = position + normal * uLen * uLayer;
  p.y -= uLen * 0.3 * uLayer * uLayer;           // a touch of gravity on the tips
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const FUR_FRAG = /* glsl */ `
uniform float uLayer; uniform float uDensity; uniform float uOpaque;
uniform vec3 uRoot; uniform vec3 uTip;
varying vec3 vN; varying vec3 vV; varying vec3 vObj; varying vec3 vON;
float hash(vec3 p) { p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
void main() {
  if (uOpaque < 0.5) {
    // a gently warped, rotated grid so no pattern lines up with the body
    vec3 w = vObj + 0.012 * sin(vObj.yzx * 37.0 + vObj.zxy * 23.0);
    vec3 q = mat3(0.80, 0.36, -0.48, -0.48, 0.86, -0.16, 0.36, 0.36, 0.86) * w * uDensity;
    vec3 c = floor(q);
    vec3 f = fract(q) - 0.5;
    vec3 n = normalize(mat3(0.80, 0.36, -0.48, -0.48, 0.86, -0.16, 0.36, 0.36, 0.86) * vON);
    f -= dot(f, n) * n;                            // strands are columns along the normal
    float h = hash(c), h2 = hash(c + 17.31);
    float len = mix(0.45, 1.0, h);
    if (h2 > 0.94) len = 1.4;                      // the odd flyaway fibre
    if (uLayer > len) discard;
    float thick = (1.0 - uLayer / len) * 0.42 + 0.14;
    if (length(f) > thick) discard;
  }
  vec3 N = normalize(vN), V = normalize(vV);
  vec3 L1 = normalize(vec3(0.45, 0.75, 0.6)), L2 = normalize(vec3(-0.7, 0.25, 0.45));
  float d = 0.42 + 0.6 * max(dot(N, L1), 0.0) + 0.16 * max(dot(N, L2), 0.0);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.4);
  float ao = mix(0.55, 1.05, uLayer);
  vec3 col = mix(uRoot, uTip, uLayer) * d * ao + uTip * rim * 0.5;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

function Fur({ geometry, root, tip, layers = 18, length = 0.03, density = 160 }) {
  const shared = useMemo(() => ({
    uRoot: { value: new THREE.Color(root) }, uTip: { value: new THREE.Color(tip) },
    uLen: { value: length }, uDensity: { value: density },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { shared.uRoot.value.set(root); shared.uTip.value.set(tip); }, [root, tip, shared]);
  const mats = useMemo(() => Array.from({ length: layers + 1 }, (_, i) => new THREE.ShaderMaterial({
    uniforms: { ...shared, uLayer: { value: i / layers }, uOpaque: { value: i === 0 ? 1 : 0 } },
    vertexShader: FUR_VERT, fragmentShader: FUR_FRAG, toneMapped: false,
  })), [layers, shared]);
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
  return <group>{mats.map((m, i) => <mesh key={i} geometry={geometry} material={m} />)}</group>;
}

/* ---------------- shapes ---------------- */
// The blob: an egg that's a little wider at the bottom, with two felt feet merged in.
const BLOB = { a: 0.68, bTop: 0.62, bBot: 0.56, c: 0.62 };
function sphere(r, w = 48, h = 32) { return new THREE.SphereGeometry(r, w, h); }
function deform(geo, fn) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v); p.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals();
  return geo;
}
function feet(y = -0.5, z = 0.3, x = 0.24) {
  return [-1, 1].map((s) => deform(sphere(1, 24, 16), (v) => { v.set(v.x * 0.15 + s * x, v.y * 0.11 + y, v.z * 0.16 + z); }));
}
function blobGeometry() {
  const body = deform(sphere(1, 64, 48), (v) => {
    const bottom = v.y < 0;
    const widen = bottom ? 1 + 0.06 * -v.y : 1;
    v.set(v.x * BLOB.a * widen, v.y * (bottom ? BLOB.bBot : BLOB.bTop), v.z * BLOB.c * widen);
  });
  return mergeGeometries([body, ...feet()].map((g) => g.toNonIndexed()));
}
// The heart: two round lobes and a soft point, all felt.
const HEART = { a: 0.72, bTop: 0.6, bBot: 0.6, c: 0.5 };
function heartGeometry() {
  const lobes = [-1, 1].map((s) => deform(sphere(1), (v) => { v.set(v.x * 0.42 + s * 0.27, v.y * 0.4 + 0.16, v.z * 0.45); }));
  const point = deform(sphere(1, 48, 32), (v) => {
    const k = v.y < 0 ? 1 + v.y * 0.62 : 1;           // narrow toward the bottom point
    v.set(v.x * 0.62 * k, v.y * 0.58 - 0.08, v.z * 0.48 * (v.y < 0 ? 1 + v.y * 0.3 : 1));
  });
  return mergeGeometries([...lobes, point, ...feet(-0.62, 0.22, 0.2)].map((g) => g.toNonIndexed()));
}
const surfZ = (B, x, y) => B.c * Math.sqrt(Math.max(0, 1 - (x / B.a) ** 2 - (y / (y >= 0 ? B.bTop : B.bBot)) ** 2));

// Clothes that wrap the lower body: a shell following the body with an opening at
// the front that is wider at the top (lapels / an open gown).
function wrapGeometry(B, { y0, y1, gapTop, gapBottom, pad = 0.06, flare = 0, folds = 0, range = null }) {
  const segU = 72, segV = 24, pos = [], uv = [], idx = [];
  for (let j = 0; j <= segV; j++) {
    const v = j / segV, y = y0 + (y1 - y0) * v;
    const b = y >= 0 ? B.bTop : B.bBot;
    const k = Math.sqrt(Math.max(0.05, 1 - (y / b) ** 2));
    const gap = gapBottom + (gapTop - gapBottom) * v;
    const p = pad + flare * (1 - v);
    for (let i = 0; i <= segU; i++) {
      const u = i / segU;
      const phi = range ? range[0] + u * (range[1] - range[0]) : gap / 2 + u * (Math.PI * 2 - gap);
      const fold = 1 + folds * Math.sin(phi * 8) * (1 - v);
      pos.push((B.a * k + p) * fold * Math.sin(phi), y, (B.c * k + p) * fold * Math.cos(phi));
      uv.push(u, v);
    }
  }
  for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
    const a = j * (segU + 1) + i, b2 = a + segU + 1;
    idx.push(a, b2, a + 1, b2, b2 + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// The opening's edge, for the gown's gold trim.
function wrapEdge(B, o, side) {
  const pts = [];
  for (let j = 0; j <= 20; j++) {
    const v = j / 20, y = o.y0 + (o.y1 - o.y0) * v;
    const b = y >= 0 ? B.bTop : B.bBot;
    const k = Math.sqrt(Math.max(0.05, 1 - (y / b) ** 2));
    const gap = o.gapBottom + (o.gapTop - o.gapBottom) * v;
    const phi = side * gap / 2;
    const p = (o.pad || 0.06) + (o.flare || 0) * (1 - v) + 0.004;
    pts.push(new THREE.Vector3((B.a * k + p) * Math.sin(phi), y, (B.c * k + p) * Math.cos(phi)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.012, 6, false);
}

/* ---------------- materials ---------------- */
const Felt = ({ color, sheen, ...p }) => (
  <meshPhysicalMaterial color={color} roughness={0.95} sheen={0.45} sheenRoughness={0.7} sheenColor={sheen || color} side={THREE.DoubleSide} {...p} />
);
const Metal = ({ color = '#c9ccd2' }) => <meshStandardMaterial color={color} metalness={1} roughness={0.22} />;
const Gloss = ({ color }) => <meshPhysicalMaterial color={color} roughness={0.06} clearcoat={1} clearcoatRoughness={0.03} />;

/* ---------------- face ---------------- */
function starGeometry() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.045 : 0.11, a = (Math.PI / 5) * i - Math.PI / 2;
    i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false }); g.center(); return g;
}

// One eye: a sclera/rim ball, an iris ball pushed forward, glossy; and a felt lid
// (a half shell) that rotates down to blink, squint or sleep.
function Eye({ x, y, z, r, iris, rim, irisScale, lidColor, lid, slant, kind, starGeo, stitch }) {
  const lidRef = useRef();
  useFrame(() => { if (lidRef.current) lidRef.current.rotation.x = lerp(lidRef.current.rotation.x, lid.current, 0.35); });
  const pupil = irisScale < 0.8; // a white eye with a separate dark pupil
  if (kind === 'closed') {
    // asleep: a stitched, curved line instead of the eye
    return (
      <mesh position={[x, y, z + r * 0.55]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[r * 0.7, 0.012, 8, 24, Math.PI * 0.85]} />
        <meshBasicMaterial color={stitch} />
      </mesh>
    );
  }
  return (
    <group position={[x, y, z]}>
      {kind === 'star' ? (
        <>
          <mesh><sphereGeometry args={[r, 32, 24]} /><Gloss color={rim} /></mesh>
          <mesh position={[0, 0, r * 0.9]} geometry={starGeo} scale={r * 7.5}><Gloss color="#141418" /></mesh>
        </>
      ) : kind === 'dizzy' ? (
        <>
          <mesh><sphereGeometry args={[r, 32, 24]} /><Gloss color={rim} /></mesh>
          <mesh position={[0, 0, r * 0.95]}><torusGeometry args={[r * 0.5, r * 0.09, 8, 28]} /><meshBasicMaterial color="#111" /></mesh>
          <mesh position={[0, 0, r * 0.97]}><torusGeometry args={[r * 0.22, r * 0.08, 8, 20]} /><meshBasicMaterial color="#111" /></mesh>
        </>
      ) : (
        <>
          <mesh><sphereGeometry args={[r, 32, 24]} /><Gloss color={rim} /></mesh>
          <mesh position={[0, 0, r * (pupil ? 0.42 : 0.2)]}><sphereGeometry args={[r * irisScale, 32, 24]} /><Gloss color={iris} /></mesh>
          {pupil && <mesh position={[0, 0, r * 0.62]}><sphereGeometry args={[r * irisScale * 0.55, 24, 16]} /><Gloss color="#0b0b0d" /></mesh>}
        </>
      )}
      {/* the lid: a felt half-shell over the eye (none over star eyes) */}
      {kind !== 'star' && <group rotation={[0, 0, slant]}>
        <mesh ref={lidRef} rotation={[-1.2, 0, 0]}>
          <sphereGeometry args={[r * 1.12, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <Felt color={lidColor} />
        </mesh>
      </group>}
    </group>
  );
}

function Mouth({ y, z, kind, color }) {
  if (kind === 'o') return <mesh position={[0, y, z]}><torusGeometry args={[0.028, 0.009, 8, 20]} /><meshBasicMaterial color={color} /></mesh>;
  const smile = kind !== 'frown';
  const w = kind === 'big' ? 0.075 : 0.05;
  return (
    <mesh position={[0, y + (smile ? 0.02 : -0.012), z]} rotation={[0, 0, smile ? Math.PI : 0]}>
      <torusGeometry args={[w, 0.009, 8, 24, Math.PI * 0.8]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

// Little stitched brows, like the felt toys.
function Stitches({ x, y, z, color, tilt = 0 }) {
  return [-1, 1].map((s) => (
    <group key={s} position={[x * s, y, z]} rotation={[-0.35, 0, s * (0.18 + tilt)]}>
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[i * 0.03, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.006, 0.016, 4, 6]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </group>
  ));
}

/* ---------------- accessories ---------------- */
function WireGlasses({ x, y, z, r, ovalX = 1, color = '#c9ccd2', temples = 0.5 }) {
  return (
    <group position={[0, y, z]}>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[x * s, 0, 0]} scale={[ovalX, 1, 1]}><torusGeometry args={[r, 0.008, 8, 40]} /><Metal color={color} /></mesh>
          <mesh position={[x * s, 0, -0.005]} scale={[ovalX, 1, 1]}><circleGeometry args={[r, 32]} /><meshPhysicalMaterial color="#ffffff" transparent opacity={0.08} roughness={0} /></mesh>
          {/* temple arm going back along the head */}
          <mesh position={[(x + r * ovalX) * s + s * 0.02, 0.01, -temples / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.006, 0.006, temples, 6]} /><Metal color={color} />
          </mesh>
        </group>
      ))}
      {/* bridge */}
      <mesh position={[0, 0.02, 0.01]} rotation={[0, 0, 0]}><torusGeometry args={[x - r * ovalX, 0.007, 6, 16, Math.PI]} /><Metal color={color} /></mesh>
    </group>
  );
}
function NerdGlasses({ x, y, z }) {
  const geo = useMemo(() => {
    const rr = (w, h, rad) => { const s = new THREE.Shape(); s.moveTo(-w + rad, -h); s.lineTo(w - rad, -h); s.quadraticCurveTo(w, -h, w, -h + rad); s.lineTo(w, h - rad); s.quadraticCurveTo(w, h, w - rad, h); s.lineTo(-w + rad, h); s.quadraticCurveTo(-w, h, -w, h - rad); s.lineTo(-w, -h + rad); s.quadraticCurveTo(-w, -h, -w + rad, -h); return s; };
    const outer = rr(0.19, 0.14, 0.05), hole = rr(0.155, 0.105, 0.035);
    outer.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(outer, { depth: 0.035, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 });
    g.center(); return g;
  }, []);
  return (
    <group position={[0, y, z]}>
      {[-1, 1].map((s) => (
        <group key={s} position={[x * s, 0, 0]} rotation={[0, -s * 0.12, 0]}>
          <mesh geometry={geo}><meshPhysicalMaterial color="#0c0c0e" roughness={0.3} clearcoat={0.8} /></mesh>
          <mesh position={[0, 0, -0.01]}><planeGeometry args={[0.31, 0.21]} /><meshPhysicalMaterial color="#cfe3ff" transparent opacity={0.1} roughness={0} /></mesh>
        </group>
      ))}
      <mesh position={[0, 0.03, 0]}><boxGeometry args={[0.1, 0.035, 0.035]} /><meshPhysicalMaterial color="#0c0c0e" roughness={0.3} /></mesh>
      {[-1, 1].map((s) => (
        <mesh key={'t' + s} position={[s * (x + 0.19), 0.04, -0.28]} rotation={[0, 0, 0]}><boxGeometry args={[0.03, 0.03, 0.56]} /><meshPhysicalMaterial color="#0c0c0e" roughness={0.3} /></mesh>
      ))}
    </group>
  );
}
function Beret() {
  return (
    <group position={[-0.06, 0.6, -0.02]} rotation={[-0.12, 0, 0.22]}>
      <mesh scale={[1, 0.3, 0.95]}><sphereGeometry args={[0.5, 48, 24]} /><Felt color="#17171b" sheen="#5a5a66" /></mesh>
      <mesh position={[0, -0.06, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.41, 0.03, 10, 48]} /><Felt color="#121215" /></mesh>
      <mesh position={[0.02, 0.16, 0]}><cylinderGeometry args={[0.018, 0.026, 0.07, 10]} /><Felt color="#17171b" /></mesh>
    </group>
  );
}
function Mortarboard() {
  const tassel = useRef();
  useFrame((s) => { if (tassel.current) tassel.current.rotation.z = Math.sin(s.clock.elapsedTime * 1.6) * 0.08; });
  return (
    <group position={[0, 0.56, -0.02]} rotation={[0.1, 0, -0.04]}>
      <mesh><cylinderGeometry args={[0.4, 0.44, 0.24, 40]} /><Felt color="#16161a" sheen="#55555f" /></mesh>
      <group position={[0, 0.14, 0]} rotation={[0, Math.PI / 4, 0]}>
        <mesh><boxGeometry args={[0.98, 0.035, 0.98]} /><Felt color="#18181c" sheen="#55555f" /></mesh>
      </group>
      <mesh position={[0, 0.17, 0]}><cylinderGeometry args={[0.03, 0.03, 0.025, 12]} /><Felt color="#101013" /></mesh>
      {/* cord to the corner, then the tassel hanging down */}
      <mesh position={[0.34, 0.165, 0.0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.008, 0.008, 0.68, 6]} /><meshStandardMaterial color="#0d0d0f" roughness={0.8} /></mesh>
      <group ref={tassel} position={[0.69, 0.15, 0]}>
        <mesh position={[0, -0.05, 0]}><cylinderGeometry args={[0.022, 0.022, 0.05, 12]} /><Metal color="#c9a04a" /></mesh>
        <mesh position={[0, -0.22, 0]}><cylinderGeometry args={[0.02, 0.05, 0.3, 14]} /><meshStandardMaterial color="#0d0d0f" roughness={0.9} /></mesh>
      </group>
    </group>
  );
}
// A small hologram of code that floats beside the coder.
function CodeHologram() {
  const ref = useRef();
  const tex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    x.font = '600 34px ui-monospace, Menlo, Consolas, monospace';
    x.fillStyle = 'rgba(140,220,255,.55)';
    ['print("Hello")', 'def study():', '  return "A+"', 'print("Hello")', 'for i in range(3):'].forEach((l, i) => x.fillText(l, 40, 70 + i * 52));
    x.font = '300 360px ui-monospace, Menlo, Consolas, monospace';
    x.shadowColor = '#7fe0ff'; x.shadowBlur = 28;
    x.fillStyle = 'rgba(190,240,255,.95)';
    x.fillText('{', 40, 430); x.fillText('}', 290, 430);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, []);
  useFrame((s) => {
    if (!ref.current) return;
    const t = s.clock.elapsedTime;
    ref.current.position.y = -0.22 + Math.sin(t * 1.4) * 0.04;
    ref.current.material.opacity = 0.82 + Math.sin(t * 9) * 0.04 + (Math.sin(t * 2.3) > 0.97 ? -0.3 : 0);
  });
  return (
    <mesh ref={ref} position={[0.86, -0.22, 0.32]} rotation={[0, -0.35, 0]}>
      <planeGeometry args={[0.62, 0.62]} />
      <meshBasicMaterial map={tex} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function Confetti({ active }) {
  const seeds = useMemo(() => Array.from({ length: 34 }, () => ({
    x: (Math.random() - 0.5) * 2.6, y: Math.random() * 2.4, z: (Math.random() - 0.5) * 1.6,
    s: 0.025 + Math.random() * 0.03, vy: 0.4 + Math.random() * 0.6, vr: (Math.random() - 0.5) * 4,
    color: ['#ffd166', '#ff6b6b', '#6aa9ff', '#57e39b', '#ffffff'][Math.floor(Math.random() * 5)],
  })), []);
  const refs = useRef([]);
  useFrame((_, dt) => {
    if (!active) return;
    refs.current.forEach((m, i) => { if (!m) return; m.position.y -= seeds[i].vy * dt; m.rotation.z += seeds[i].vr * dt; if (m.position.y < -1.1) m.position.y = 1.6; });
  });
  if (!active) return null;
  return seeds.map((s, i) => (
    <mesh key={i} ref={(el) => (refs.current[i] = el)} position={[s.x, s.y, s.z]}>
      <boxGeometry args={[s.s, s.s * 0.5, s.s]} /><meshStandardMaterial color={s.color} />
    </mesh>
  ));
}

/* ---------------- the outfits ---------------- */
// fur root/tip colours, face, eyes, clothes
export const OUTFITS = {
  classic: { fur: ['#9e1620', '#d8343c'], shape: 'blob', eye: { iris: '#08080a', rim: '#d9d9de', irisScale: 0.92, r: 0.12 }, lid: -1.25, brows: true, mouth: 'smile', mouthColor: '#4a0b10' },
  professor: { fur: ['#555c69', '#9aa1ae'], shape: 'blob', eye: { iris: '#6b3a1c', rim: '#f2efe9', irisScale: 0.7, r: 0.105 }, lid: -0.15, slant: 0.32, mouth: 'frown', mouthColor: '#2c3039', outfit: 'suit' },
  graduate: { fur: ['#5b6271', '#a3aab8'], shape: 'blob', eye: { iris: '#6e3d1f', rim: '#f2efe9', irisScale: 0.7, r: 0.1 }, lid: -0.1, slant: 0.36, mouth: 'frown', mouthColor: '#2c3039', outfit: 'gown' },
  coder: { fur: ['#141b33', '#2e3b66'], shape: 'blob', eye: { iris: '#1d1d22', rim: '#f4f4f6', irisScale: 0.66, r: 0.125 }, lid: -1.25, brows: true, mouth: 'smile', mouthColor: '#0a0e1d' },
  heart: { fur: ['#b8524a', '#ee9a8c'], shape: 'heart', eye: { iris: '#4a2a1a', rim: '#f7f2ee', irisScale: 0.72, r: 0.095 }, lid: -1.25, brows: true, mouth: 'smile', mouthColor: '#6a2a24' },
};

// lighten/darken a hex colour (for the classic blob tinted to the student's colour)
function shade(hex, k) {
  const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.05), Math.max(0, Math.min(1, hsl.l * k))); return '#' + c.getHexString();
}

export default function FuzzyCassie({ emotion, outfit = 'classic', accent = null }) {
  const o = OUTFITS[outfit] || OUTFITS.classic;
  const pose = emotion.pose;
  const rig = useRef(), armL = useRef(), armR = useRef();
  const lid = useRef(o.lid);
  const blink = useRef({ next: 2 + Math.random() * 3, until: 0 });
  const starGeo = useMemo(() => starGeometry(), []);

  const blob = useMemo(() => blobGeometry(), []);
  const heart = useMemo(() => heartGeometry(), []);
  const B = o.shape === 'heart' ? HEART : BLOB;
  const paw = useMemo(() => deform(sphere(1, 28, 20), (v) => v.set(v.x * 0.13, v.y * 0.15, v.z * 0.13)), []);
  const suit = useMemo(() => ({
    jacket: wrapGeometry(BLOB, { y0: -0.5, y1: 0.02, gapTop: 1.2, gapBottom: 0.12, pad: 0.075 }),
    shirt: wrapGeometry(BLOB, { y0: -0.42, y1: 0.03, gapTop: 0, gapBottom: 0, pad: 0.066, range: [-0.62, 0.62] }),
  }), []);
  const gownOpts = { y0: -0.56, y1: 0.08, gapTop: 1.5, gapBottom: 0.5, pad: 0.075, flare: 0.07, folds: 0.025 };
  const gown = useMemo(() => ({ body: wrapGeometry(BLOB, gownOpts), trimL: wrapEdge(BLOB, gownOpts, -1), trimR: wrapEdge(BLOB, gownOpts, 1) }), []); // eslint-disable-line react-hooks/exhaustive-deps

  let [root, tip] = o.fur;
  if (outfit === 'classic' && accent) { root = shade(accent, 0.62); tip = shade(accent, 1.12); }

  // eyes: where the face sits on this body
  const ex = o.shape === 'heart' ? 0.21 : 0.21, ey = o.shape === 'heart' ? 0.05 : 0.11;
  const ez = surfZ(B, ex, ey) - o.eye.r * 0.35;
  const lidRest = pose.eyes === 'closed' ? 1.45 : pose.eyes === 'angry' ? -0.05 : o.lid;
  const slant = pose.eyes === 'angry' ? 0.42 : (o.slant || 0);
  const eyeKind = ['star', 'dizzy', 'closed'].includes(pose.eyes) ? pose.eyes : 'round';
  const mouthKind = pose.eyes === 'closed' ? 'smile' : pose.icon === 'question' ? 'o' : pose.jump > 0.1 ? 'big' : o.mouth;
  const sleeves = o.outfit === 'suit' ? '#121216' : o.outfit === 'gown' ? '#4b1d24' : null;

  useFrame((state, dt) => {
    const t = Math.min(1, dt * 6), time = state.clock.elapsedTime;
    // blinking (not while asleep)
    const b = blink.current;
    if (time > b.next) { b.until = time + 0.12; b.next = time + 2.5 + Math.random() * 3.5; }
    lid.current = time < b.until && pose.eyes !== 'closed' ? 1.45 : lidRest;
    if (rig.current) {
      const breathe = Math.sin(time * 1.8) * 0.012;
      const jumpY = pose.jump * (0.55 + 0.45 * Math.abs(Math.sin(time * 4)));
      rig.current.position.y = lerp(rig.current.position.y, jumpY + Math.sin(time * 1.4) * 0.02, t);
      rig.current.scale.set(1 + breathe, 1 - breathe, 1 + breathe);
      rig.current.rotation.y = Math.sin(time * 0.5) * 0.16;
      rig.current.rotation.z = lerp(rig.current.rotation.z, pose.headZ * 0.55, t);
      rig.current.rotation.x = lerp(rig.current.rotation.x, pose.headX * 0.5, t);
      if (pose.shake) rig.current.position.x = Math.sin(time * 34) * 0.03;
      else if (pose.wobble) rig.current.position.x = Math.sin(time * 7) * 0.05;
      else rig.current.position.x = lerp(rig.current.position.x, 0, t);
    }
    // arms: little paws that lift when she's excited
    const lift = (v) => Math.min(1.5, Math.abs(v) * 0.55);
    if (armL.current) armL.current.rotation.z = lerp(armL.current.rotation.z, -lift(pose.armL) + 0.0, t);
    if (armR.current) armR.current.rotation.z = lerp(armR.current.rotation.z, lift(pose.armR), t);
  });

  const armPos = sleeves ? [0.56, -0.1, 0.18] : [0.62, -0.08, 0.1];
  // in a suit or gown the paws come together in front of the tummy
  const PAW = [-0.4, -0.08, 0.5];
  const sleeveQ = useMemo(() => [-1, 1].map((s) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(PAW[0] * s, PAW[1], PAW[2]).normalize())), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group ref={rig}>
      <Fur geometry={o.shape === 'heart' ? heart : blob} root={root} tip={tip} />

      {/* arms (pivot at the shoulder) */}
      {[[-1, armL], [1, armR]].map(([s, ref]) => (
        <group key={s} ref={ref} position={[armPos[0] * s, armPos[1], armPos[2]]}>
          {sleeves && <mesh position={[PAW[0] * s * 0.45, PAW[1] * 0.45, PAW[2] * 0.45]} quaternion={sleeveQ[(s + 1) / 2]}><capsuleGeometry args={[0.1, 0.38, 6, 14]} /><Felt color={sleeves} /></mesh>}
          <group position={sleeves ? [PAW[0] * s, PAW[1], PAW[2]] : [0, -0.02, 0]} scale={sleeves ? 0.72 : 1}>
            <Fur geometry={paw} root={root} tip={tip} layers={10} />
          </group>
        </group>
      ))}

      {/* face */}
      {[-1, 1].map((s) => (
        <Eye key={s} x={ex * s} y={ey} z={ez} r={o.eye.r} iris={o.eye.iris} rim={o.eye.rim} irisScale={o.eye.irisScale}
          lidColor={tip} lid={lid} slant={s * slant} kind={eyeKind} starGeo={starGeo} stitch={o.mouthColor} />
      ))}
      {o.brows && pose.eyes !== 'angry' && <Stitches x={ex} y={ey + 0.17} z={surfZ(B, ex, ey + 0.17) + 0.03} color={o.mouthColor} />}
      <Mouth y={ey - 0.17} z={surfZ(B, 0, ey - 0.17) + 0.035} kind={mouthKind} color={o.mouthColor} />

      {/* outfits */}
      {outfit === 'professor' && (
        <>
          <Beret />
          <WireGlasses x={ex} y={ey + 0.01} z={ez + o.eye.r + 0.02} r={0.105} ovalX={1.3} />
          <mesh geometry={suit.shirt}><Felt color="#e9e8e4" /></mesh>
          <mesh geometry={suit.jacket}><Felt color="#121216" sheen="#3a3a44" /></mesh>
          {/* collar points and tie */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0.075 * s, -0.0, surfZ(BLOB, 0.07, 0) + 0.09]} rotation={[-0.25, 0, s * 0.85]}>
              <boxGeometry args={[0.13, 0.06, 0.012]} /><meshStandardMaterial color="#f2f1ee" roughness={0.7} />
            </mesh>
          ))}
          <mesh position={[0, -0.03, surfZ(BLOB, 0, -0.03) + 0.09]}><boxGeometry args={[0.06, 0.05, 0.03]} /><meshStandardMaterial color="#0d0d10" roughness={0.6} /></mesh>
          <mesh position={[0, -0.24, surfZ(BLOB, 0, -0.24) + 0.085]} rotation={[0.38, 0, 0]}>
            <cylinderGeometry args={[0.022, 0.05, 0.38, 4]} /><meshStandardMaterial color="#0d0d10" roughness={0.6} />
          </mesh>
        </>
      )}
      {outfit === 'graduate' && (
        <>
          <Mortarboard />
          <WireGlasses x={0.13} y={ey - 0.06} z={ez + o.eye.r + 0.04} r={0.06} ovalX={1.2} temples={0.4} />
          <mesh geometry={gown.body}><Felt color="#4b1d24" sheen="#8a4a52" /></mesh>
          <mesh geometry={gown.trimL}><Metal color="#c9a04a" /></mesh>
          <mesh geometry={gown.trimR}><Metal color="#c9a04a" /></mesh>
        </>
      )}
      {outfit === 'coder' && (
        <>
          <NerdGlasses x={ex + 0.01} y={ey + 0.01} z={ez + o.eye.r + 0.03} />
          <CodeHologram />
        </>
      )}
      {outfit === 'heart' && <WireGlasses x={ex} y={ey} z={ez + o.eye.r + 0.02} r={0.115} color="#d8d2c8" temples={0.3} />}

      <Confetti active={pose.confetti} />
    </group>
  );
}

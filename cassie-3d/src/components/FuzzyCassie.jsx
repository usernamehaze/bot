import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBox } from '@react-three/drei';

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
  return body;
}
// The heart: two round lobes and a soft point, all felt.
const HEART = { a: 0.72, bTop: 0.6, bBot: 0.6, c: 0.5 };
function heartGeometry() {
  const lobes = [-1, 1].map((s) => deform(sphere(1), (v) => { v.set(v.x * 0.42 + s * 0.27, v.y * 0.4 + 0.16, v.z * 0.45); }));
  const point = deform(sphere(1, 48, 32), (v) => {
    const k = v.y < 0 ? 1 + v.y * 0.62 : 1;           // narrow toward the bottom point
    v.set(v.x * 0.62 * k, v.y * 0.58 - 0.08, v.z * 0.48 * (v.y < 0 ? 1 + v.y * 0.3 : 1));
  });
  return mergeGeometries([...lobes, point].map((g) => g.toNonIndexed()));
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
// Eyes like the felt toys in the reference: a white rim, a big glossy iris with a
// pupil and two catch-lights. Blinking squashes the eye shut; asleep and happy
// eyes are drawn as curved lines (‿ and ^), never as a pale lid.
function Eye({ x, y, z, r, iris, rim, irisScale, kind, look, blink, line }) {
  const g = useRef(), pupil = useRef();
  useFrame(() => {
    if (g.current) g.current.scale.y = lerp(g.current.scale.y, blink.current ? 0.08 : 1, 0.45);
    if (pupil.current) {
      pupil.current.position.x = lerp(pupil.current.position.x, look.current[0] * r * 0.28, 0.15);
      pupil.current.position.y = lerp(pupil.current.position.y, look.current[1] * r * 0.28, 0.15);
    }
  });
  if (kind === 'closed' || kind === 'happy') {
    return (
      <mesh position={[x, y + (kind === 'happy' ? -r * 0.15 : r * 0.1), z + r * 0.7]} rotation={[0, 0, kind === 'happy' ? 0 : Math.PI]}>
        <torusGeometry args={[r * 0.62, r * 0.11, 8, 24, Math.PI]} />
        <meshBasicMaterial color={line} />
      </mesh>
    );
  }
  return (
    <group position={[x, y, z]}>
      <group ref={g}>
        <mesh><sphereGeometry args={[r, 32, 24]} /><Gloss color={rim} /></mesh>
        {kind === 'dizzy' ? (
          <>
            <mesh position={[0, 0, r * 0.96]}><torusGeometry args={[r * 0.5, r * 0.08, 8, 28]} /><meshBasicMaterial color="#141418" /></mesh>
            <mesh position={[0, 0, r * 0.98]}><torusGeometry args={[r * 0.22, r * 0.07, 8, 20]} /><meshBasicMaterial color="#141418" /></mesh>
          </>
        ) : (
          <group ref={pupil}>
            {/* the iris and pupil sit ON the front of the eyeball, so the colour always shows */}
            <mesh position={[0, 0, r * 1.02 - r * irisScale * 0.32]} scale={[1, 1, 0.32]}><sphereGeometry args={[r * irisScale, 32, 24]} /><Gloss color={iris} /></mesh>
            <mesh position={[0, 0, r * 1.05 - r * irisScale * 0.5 * 0.3]} scale={[1, 1, 0.3]}><sphereGeometry args={[r * irisScale * 0.5, 24, 16]} /><Gloss color="#07070a" /></mesh>
            {/* catch-lights */}
            <mesh position={[-r * 0.28, r * 0.3, r * 1.07]}><sphereGeometry args={[r * 0.16, 12, 10]} /><meshBasicMaterial color="#ffffff" /></mesh>
            <mesh position={[r * 0.22, -r * 0.22, r * 1.06]}><sphereGeometry args={[r * 0.07, 10, 8]} /><meshBasicMaterial color="#ffffff" /></mesh>
          </group>
        )}
      </group>
    </group>
  );
}

function Mouth({ y, z, kind, color }) {
  if (kind === 'o') return <mesh position={[0, y, z]} scale={[1, 1.25, 1]}><circleGeometry args={[0.03, 20]} /><meshBasicMaterial color={color} side={THREE.DoubleSide} /></mesh>;
  if (kind === 'open') {
    return (
      <group position={[0, y + 0.02, z]}>
        <mesh rotation={[0, 0, Math.PI]}><circleGeometry args={[0.075, 28, 0, Math.PI]} /><meshBasicMaterial color="#3a0b10" side={THREE.DoubleSide} /></mesh>
        <mesh position={[0, -0.045, 0.002]} scale={[1, 0.55, 1]}><circleGeometry args={[0.035, 20]} /><meshBasicMaterial color="#e86a7a" side={THREE.DoubleSide} /></mesh>
      </group>
    );
  }
  if (kind === 'hmm') return <mesh position={[0.03, y, z]} rotation={[0, 0, 0.15]}><capsuleGeometry args={[0.008, 0.05, 4, 8]} /><meshBasicMaterial color={color} /></mesh>;
  const smile = kind !== 'frown';
  const w = kind === 'big' ? 0.072 : 0.05;
  return (
    <mesh position={[0, y + (smile ? 0.02 : -0.012), z]} rotation={[0, 0, smile ? Math.PI : 0]}>
      <torusGeometry args={[w, 0.009, 8, 24, Math.PI * 0.8]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

// Little stitched brows, like the felt toys. `mood` tilts them.
function Brows({ x, y, z, color, mood }) {
  const tilt = mood === 'angry' ? -0.55 : mood === 'up' ? 0.3 : 0.18;
  return [-1, 1].map((s) => (
    <group key={s} position={[x * s, y + (mood === 'up' && s > 0 ? 0.03 : 0), z]} rotation={[-0.35, 0, s * tilt]}>
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[i * 0.03, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.006, 0.016, 4, 6]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </group>
  ));
}

/* ---------------- floating props (bulb, ?, Zzz, keyboard, pillow) ---------------- */
function textSprite(text, color, glow) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  x.font = '800 96px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = glow; x.shadowBlur = 18; x.fillStyle = color; x.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function Bulb({ y }) {
  const g = useRef();
  const q = useMemo(() => textSprite('?', '#ffd23f', '#ffb000'), []);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    if (g.current) { g.current.position.y = y + Math.sin(t * 2) * 0.04; g.current.children.forEach((c, i) => { if (c.isSprite) c.position.y = 0.05 + Math.sin(t * 2.4 + i * 1.7) * 0.05; }); }
  });
  return (
    <group ref={g} position={[0, y, 0.1]}>
      <mesh><sphereGeometry args={[0.11, 24, 18]} /><meshStandardMaterial color="#fff2b0" emissive="#ffd84a" emissiveIntensity={2.2} toneMapped={false} /></mesh>
      <mesh position={[0, -0.13, 0]}><cylinderGeometry args={[0.05, 0.045, 0.07, 14]} /><Metal color="#b8bcc4" /></mesh>
      <pointLight color="#ffd84a" intensity={1.2} distance={1.6} />
      <sprite position={[-0.32, 0.05, 0]} scale={0.2}><spriteMaterial map={q} transparent depthWrite={false} toneMapped={false} /></sprite>
      <sprite position={[0.3, 0.1, 0]} scale={0.24}><spriteMaterial map={q} transparent depthWrite={false} toneMapped={false} /></sprite>
    </group>
  );
}
function Question({ y }) {
  const ref = useRef();
  const q = useMemo(() => textSprite('?', '#ffd23f', '#ffb000'), []);
  useFrame((s) => { if (ref.current) ref.current.position.y = y + Math.sin(s.clock.elapsedTime * 2.6) * 0.05; });
  return <sprite ref={ref} position={[0.45, y, 0.1]} scale={0.26}><spriteMaterial map={q} transparent depthWrite={false} toneMapped={false} /></sprite>;
}
function Zzz({ y }) {
  const z = useMemo(() => textSprite('Z', '#bfe6ff', '#6cc7ff'), []);
  const refs = useRef([]);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    refs.current.forEach((m, i) => {
      if (!m) return;
      const k = ((t * 0.45 + i / 3) % 1);
      m.position.set(0.3 + k * 0.35, y + k * 0.55, 0.1);
      m.scale.setScalar(0.12 + k * 0.16);
      m.material.opacity = Math.sin(k * Math.PI);
    });
  });
  return [0, 1, 2].map((i) => (
    <sprite key={i} ref={(el) => (refs.current[i] = el)}><spriteMaterial map={z} transparent depthWrite={false} toneMapped={false} /></sprite>
  ));
}
function Pillow() {
  return (
    <group position={[0, -0.62, 0.02]}>
      <RoundedBox args={[1.5, 0.16, 0.95]} radius={0.08} smoothness={4}>
        <meshPhysicalMaterial color="#f4f3f0" roughness={0.85} sheen={0.6} sheenColor="#ffffff" />
      </RoundedBox>
    </group>
  );
}
// A floating holographic keyboard she types on.
function HoloKeys({ y }) {
  const keys = useMemo(() => {
    const out = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) out.push([(c - 4) * 0.085 + (r === 1 ? 0.03 : 0), -r * 0.07]);
    return out;
  }, []);
  const refs = useRef([]);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    refs.current.forEach((m, i) => { if (m) m.material.opacity = 0.35 + 0.55 * (Math.sin(t * 13 + i * 7.3) > 0.82 ? 1 : 0); });
  });
  return (
    <group position={[0, y, 0.82]} rotation={[-1.05, 0, 0]}>
      {keys.map(([x, z], i) => (
        <mesh key={i} ref={(el) => (refs.current[i] = el)} position={[x, z, 0]}>
          <planeGeometry args={[0.07, 0.055]} />
          <meshBasicMaterial color="#8fe6ff" transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
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

// A party-popper burst: pieces fly up and out, then flutter down.
function Confetti({ active }) {
  const seeds = useMemo(() => Array.from({ length: 46 }, () => ({
    vx: (Math.random() - 0.5) * 2.4, vy: 1.6 + Math.random() * 1.6, vz: (Math.random() - 0.5) * 1.2,
    s: 0.025 + Math.random() * 0.03, vr: (Math.random() - 0.5) * 9, delay: Math.random() * 0.5,
    color: ['#ffd166', '#ff5d73', '#5aa9ff', '#4fe0a0', '#c77dff', '#ffffff'][Math.floor(Math.random() * 6)],
  })), []);
  const refs = useRef([]), t0 = useRef(null);
  useFrame((st) => {
    if (!active) { t0.current = null; return; }
    if (t0.current == null) t0.current = st.clock.elapsedTime;
    const T = st.clock.elapsedTime - t0.current;
    refs.current.forEach((m, i) => {
      if (!m) return;
      const sd = seeds[i], t = ((T - sd.delay) % 2.6 + 2.6) % 2.6;
      const drag = Math.min(t, 0.7);
      m.position.set(sd.vx * drag, 0.6 + sd.vy * drag - 0.9 * Math.max(0, t - 0.5) - 1.2 * drag * drag, sd.vz * drag + 0.3);
      m.rotation.set(t * sd.vr, t * sd.vr * 0.7, t * sd.vr * 0.5);
    });
  });
  if (!active) return null;
  return seeds.map((sd, i) => (
    <mesh key={i} ref={(el) => (refs.current[i] = el)}>
      <boxGeometry args={[sd.s, sd.s * 0.45, sd.s * 0.1]} /><meshStandardMaterial color={sd.color} side={THREE.DoubleSide} />
    </mesh>
  ));
}

/* ---------------- moods ---------------- */
// eyes: round | happy | closed | dizzy · mouth · brows · arms (paw targets) · props
export const MOODS = {
  neutral: { eyes: 'round', mouth: 'smile', arms: 'rest' },
  happy: { eyes: 'happy', mouth: 'big', arms: 'wave', bounce: 0.05 },
  encouraging: { eyes: 'round', mouth: 'big', arms: 'open', bounce: 0.03 },
  celebratory: { eyes: 'happy', mouth: 'open', arms: 'up', jump: 0.28, confetti: true },
  thinking: { eyes: 'round', look: [0.4, 0.75], mouth: 'hmm', brows: 'up', arms: 'chin', prop: 'bulb', tilt: 0.12 },
  curious: { eyes: 'round', look: [0.3, 0.2], mouth: 'o', arms: 'rest', prop: 'question', tilt: 0.28 },
  sleep: { eyes: 'closed', mouth: 'o', arms: 'rest', prop: 'sleep', slump: 0.06, tilt: 0.1 },
  angry: { eyes: 'round', mouth: 'frown', brows: 'angry', arms: 'open', shake: true },
  dizzy: { eyes: 'dizzy', mouth: 'o', arms: 'open', wobble: true },
  walk: { eyes: 'round', mouth: 'smile', arms: 'rest', walk: true },
  peek: { eyes: 'round', look: [-0.5, 0], mouth: 'big', arms: 'wave', lean: 0.32 },
  typing: { eyes: 'round', look: [0, -0.7], mouth: 'smile', arms: 'type', prop: 'keys' },
};

// Where each paw goes (relative to its shoulder, for the RIGHT arm; mirrored for the left).
const PAWS = {
  rest: [0.13, -0.22, 0.02], open: [0.26, -0.06, 0.12], up: [0.1, 0.44, 0.05], wave: [0.14, 0.26, 0.1],
  chin: [0.13, -0.22, 0.02], type: [-0.22, -0.26, 0.5], clasp: [-0.36, -0.16, 0.44],
};
const CHIN_R = [-0.36, -0.14, 0.56]; // right paw up to the chin

/* ---------------- the outfits ---------------- */
export const OUTFITS = {
  classic: { fur: ['#9e1620', '#d8343c'], shape: 'blob', eye: { iris: '#3a2116', rim: '#efebe6', irisScale: 0.86, r: 0.125 }, mouthColor: '#4a0b10' },
  professor: { fur: ['#555c69', '#9aa1ae'], shape: 'blob', eye: { iris: '#7a4626', rim: '#f6f3ee', irisScale: 0.66, r: 0.11 }, mouthColor: '#2c3039', outfit: 'suit' },
  graduate: { fur: ['#5b6271', '#a3aab8'], shape: 'blob', eye: { iris: '#7a4626', rim: '#f6f3ee', irisScale: 0.66, r: 0.11 }, mouthColor: '#2c3039', outfit: 'gown' },
  coder: { fur: ['#141b33', '#2e3b66'], shape: 'blob', eye: { iris: '#3b7fe0', rim: '#f6f6f8', irisScale: 0.6, r: 0.13 }, mouthColor: '#0a0e1d' },
  heart: { fur: ['#b8524a', '#ee9a8c'], shape: 'heart', eye: { iris: '#5a3420', rim: '#f8f3ef', irisScale: 0.66, r: 0.1 }, mouthColor: '#6a2a24' },
};

// lighten/darken a hex colour (for the classic blob tinted to the student's colour)
function shade(hex, k) {
  const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.05), Math.max(0, Math.min(1, hsl.l * k))); return '#' + c.getHexString();
}
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const UP = new THREE.Vector3(0, 1, 0);

export default function FuzzyCassie({ mood: moodKey = 'neutral', outfit = 'classic', accent = null, facing = 0 }) {
  const o = OUTFITS[outfit] || OUTFITS.classic;
  let mood = MOODS[moodKey] || MOODS.neutral;
  if (moodKey === 'thinking' && outfit === 'coder') mood = MOODS.typing; // the coder thinks by typing
  const rig = useRef(), body = useRef();
  const paws = [useRef(), useRef()], sleevesRef = [useRef(), useRef()], feetRef = [useRef(), useRef()];
  const blink = useRef(false), look = useRef([0, 0]);
  const blinkT = useRef({ next: 2 + Math.random() * 3, until: 0 });
  const walkPhase = useRef(0);

  const blob = useMemo(() => blobGeometry(), []);
  const heart = useMemo(() => heartGeometry(), []);
  const B = o.shape === 'heart' ? HEART : BLOB;
  const paw = useMemo(() => deform(sphere(1, 28, 20), (v) => v.set(v.x * 0.13, v.y * 0.14, v.z * 0.13)), []);
  const foot = useMemo(() => deform(sphere(1, 24, 16), (v) => v.set(v.x * 0.15, v.y * 0.1, v.z * 0.17)), []);
  const suit = useMemo(() => ({
    jacket: wrapGeometry(BLOB, { y0: -0.5, y1: 0.02, gapTop: 1.2, gapBottom: 0.12, pad: 0.075 }),
    shirt: wrapGeometry(BLOB, { y0: -0.42, y1: 0.03, gapTop: 0, gapBottom: 0, pad: 0.066, range: [-0.62, 0.62] }),
  }), []);
  const gownOpts = { y0: -0.56, y1: 0.08, gapTop: 1.5, gapBottom: 0.5, pad: 0.075, flare: 0.07, folds: 0.025 };
  const gown = useMemo(() => ({ body: wrapGeometry(BLOB, gownOpts), trimL: wrapEdge(BLOB, gownOpts, -1), trimR: wrapEdge(BLOB, gownOpts, 1) }), []); // eslint-disable-line react-hooks/exhaustive-deps

  let [root, tip] = o.fur;
  if (outfit === 'classic' && accent) { root = shade(accent, 0.62); tip = shade(accent, 1.12); }

  const ex = 0.21, ey = o.shape === 'heart' ? 0.05 : 0.11;
  const ez = surfZ(B, ex, ey) - o.eye.r * 0.4;
  const sleeves = o.outfit === 'suit' ? '#121216' : o.outfit === 'gown' ? '#4b1d24' : null;
  const shoes = !!o.outfit;
  const shoulder = sleeves ? [0.5, -0.04, 0.16] : [0.55, -0.02, 0.06];
  const top = o.outfit === 'gown' ? 1.08 : o.outfit === 'suit' ? 0.98 : 0.86; // just above the head / hat

  useFrame((state, dt) => {
    const k = Math.min(1, dt * 7), time = state.clock.elapsedTime;
    // blink every few seconds
    const b = blinkT.current;
    if (time > b.next) { b.until = time + 0.13; b.next = time + 2.4 + Math.random() * 3.6; }
    blink.current = time < b.until;
    const want = mood.look || [Math.sin(time * 0.35) * 0.25, 0];
    look.current = [want[0], want[1]];

    // walking: a bouncy waddle — the body bobs twice per stride and rolls side to side
    const walking = !!mood.walk;
    if (walking) walkPhase.current += dt * 9;
    const ph = walkPhase.current;
    if (rig.current) {
      const jump = (mood.jump || 0) * Math.abs(Math.sin(time * 4.2));
      const bounce = (mood.bounce || 0) * Math.abs(Math.sin(time * 3));
      const bob = walking ? Math.abs(Math.sin(ph)) * 0.05 : Math.sin(time * 1.4) * 0.015;
      rig.current.position.y = lerp(rig.current.position.y, jump + bounce + bob - (mood.slump || 0), k);
      const roll = walking ? Math.sin(ph) * 0.07 : 0;
      rig.current.rotation.z = lerp(rig.current.rotation.z, (mood.tilt || 0) * 0.8 + roll + (mood.lean || 0), k);
      rig.current.rotation.x = lerp(rig.current.rotation.x, walking ? 0.08 : 0, k);
      const face = walking ? facing * 0.85 : Math.sin(time * 0.5) * 0.14 + (mood.lean ? -0.25 : 0);
      rig.current.rotation.y = lerp(rig.current.rotation.y, face, Math.min(1, dt * 4));
      if (mood.shake) rig.current.position.x = Math.sin(time * 34) * 0.03;
      else if (mood.wobble) rig.current.position.x = Math.sin(time * 7) * 0.05;
      else rig.current.position.x = lerp(rig.current.position.x, 0, k);
    }
    if (body.current) {
      const breathe = Math.sin(time * (moodKey === 'sleep' ? 1.1 : 1.8)) * (moodKey === 'sleep' ? 0.025 : 0.012);
      body.current.scale.set(1 + breathe, 1 - breathe, 1 + breathe);
    }
    // feet: step when walking, tap along when happy
    feetRef.forEach((ref, i) => {
      if (!ref.current) return;
      const s = i ? 1 : -1, p = ph + (i ? Math.PI : 0);
      const lift = walking ? Math.max(0, Math.sin(p)) * 0.09 : (mood.jump ? 0 : 0);
      const stride = walking ? Math.cos(p) * 0.1 : 0;
      ref.current.position.set(0.22 * s, -0.55 + lift, 0.2 + stride);
      ref.current.rotation.x = walking ? -Math.sin(p) * 0.4 : 0;
    });
    // paws (and sleeves) glide to the pose's targets; arms swing while walking
    paws.forEach((ref, i) => {
      if (!ref.current) return;
      const s = i ? 1 : -1;
      let t = PAWS[mood.arms] || PAWS.rest;
      if (sleeves && (mood.arms === 'rest' || mood.arms === 'chin')) t = PAWS.clasp;
      if (mood.arms === 'chin' && s > 0) t = CHIN_R;
      if (mood.arms === 'wave' && s < 0) t = PAWS.rest;
      const target = V([t[0] * s, t[1], t[2]]);
      if (mood.arms === 'wave' && s > 0) { target.x += Math.sin(time * 9) * 0.05; target.y += Math.cos(time * 9) * 0.03; }
      if (mood.arms === 'type') { target.y += Math.max(0, Math.sin(time * 14 + i * 2)) * 0.04; }
      if (walking) target.z += Math.sin(ph + (i ? 0 : Math.PI)) * 0.1;
      ref.current.position.lerp(target, k);
      const sl = sleevesRef[i].current;
      if (sl) {
        const d = ref.current.position.clone();
        const len = Math.max(0.05, d.length() - 0.08);
        sl.position.copy(d.clone().multiplyScalar(0.45));
        sl.quaternion.setFromUnitVectors(UP, d.normalize());
        sl.scale.set(1, len / 0.38, 1);
      }
    });
  });

  const mouthKind = mood.mouth;
  return (
    <group ref={rig}>
      <group ref={body}>
        <Fur geometry={o.shape === 'heart' ? heart : blob} root={root} tip={tip} />

        {/* face */}
        {[-1, 1].map((s) => (
          <Eye key={s} x={ex * s} y={ey} z={ez} r={o.eye.r} iris={o.eye.iris} rim={o.eye.rim} irisScale={o.eye.irisScale}
            kind={mood.eyes} look={look} blink={blink} line={o.mouthColor} />
        ))}
        <Brows x={ex} y={ey + 0.18} z={surfZ(B, ex, ey + 0.18) + 0.03} color={o.mouthColor} mood={mood.brows} />
        <Mouth y={ey - 0.17} z={surfZ(B, 0, ey - 0.17) + 0.035} kind={mouthKind} color={o.mouthColor} />

        {/* outfits */}
        {outfit === 'professor' && (
          <>
            <Beret />
            <WireGlasses x={ex} y={ey + 0.01} z={ez + o.eye.r + 0.03} r={0.12} ovalX={1.05} />
            <mesh geometry={suit.shirt}><Felt color="#e9e8e4" /></mesh>
            <mesh geometry={suit.jacket}><Felt color="#121216" sheen="#3a3a44" /></mesh>
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
            <WireGlasses x={ex} y={ey + 0.01} z={ez + o.eye.r + 0.03} r={0.115} />
            <mesh geometry={gown.body}><Felt color="#4b1d24" sheen="#8a4a52" /></mesh>
            <mesh geometry={gown.trimL}><Metal color="#c9a04a" /></mesh>
            <mesh geometry={gown.trimR}><Metal color="#c9a04a" /></mesh>
          </>
        )}
        {outfit === 'coder' && (
          <>
            <NerdGlasses x={ex + 0.01} y={ey + 0.01} z={ez + o.eye.r + 0.035} />
            {mood.prop !== 'keys' && <CodeHologram />}
          </>
        )}
        {outfit === 'heart' && <WireGlasses x={ex} y={ey} z={ez + o.eye.r + 0.03} r={0.115} color="#d8d2c8" temples={0.3} />}
      </group>

      {/* arms: a paw on each side (in sleeves for the suit and gown) */}
      {[0, 1].map((i) => {
        const s = i ? 1 : -1;
        return (
          <group key={i} position={[shoulder[0] * s, shoulder[1], shoulder[2]]}>
            {sleeves && <mesh ref={sleevesRef[i]}><capsuleGeometry args={[0.1, 0.38, 6, 14]} /><Felt color={sleeves} /></mesh>}
            <group ref={paws[i]} position={[PAWS.rest[0] * s, PAWS.rest[1], PAWS.rest[2]]} scale={sleeves ? 0.75 : 1}>
              <Fur geometry={paw} root={root} tip={tip} layers={10} />
            </group>
          </group>
        );
      })}

      {/* feet (shoes with the suit and gown, trouser legs with the suit) */}
      {[0, 1].map((i) => (
        <group key={i} ref={feetRef[i]} position={[0.22 * (i ? 1 : -1), -0.55, 0.2]}>
          {shoes ? (
            <>
              <mesh position={[0, -0.01, 0.03]} scale={[0.15, 0.085, 0.2]}><sphereGeometry args={[1, 24, 16]} /><meshPhysicalMaterial color="#111114" roughness={0.25} clearcoat={1} clearcoatRoughness={0.1} /></mesh>
              {o.outfit === 'suit' && <mesh position={[0, 0.09, -0.02]}><cylinderGeometry args={[0.1, 0.11, 0.14, 18]} /><Felt color="#121216" /></mesh>}
            </>
          ) : <Fur geometry={foot} root={root} tip={tip} layers={10} />}
        </group>
      ))}

      {/* props */}
      {mood.prop === 'bulb' && <Bulb y={top} />}
      {mood.prop === 'question' && <Question y={top - 0.1} />}
      {mood.prop === 'sleep' && <><Pillow /><Zzz y={top - 0.25} /></>}
      {mood.prop === 'keys' && <HoloKeys y={-0.3} />}
      <Confetti active={!!mood.confetti} />
    </group>
  );
}

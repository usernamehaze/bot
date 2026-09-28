import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox, Html } from '@react-three/drei';
import * as THREE from 'three';
import { PINK } from './constants';

const lerp = THREE.MathUtils.lerp;

// A five-point star, used for the celebratory eyes.
function makeStarGeometry() {
  const shape = new THREE.Shape();
  const outer = 0.13;
  const inner = 0.055;
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false });
  geo.center();
  return geo;
}

// Glossy pink emissive material factory (eyes / core).
function GlossyPink({ intensity = 2.6, transmission = 0.5, ...props }) {
  return (
    <meshPhysicalMaterial
      color={PINK}
      emissive={PINK}
      emissiveIntensity={intensity}
      roughness={0.12}
      metalness={0.1}
      clearcoat={1}
      clearcoatRoughness={0.06}
      transmission={transmission}
      thickness={0.6}
      {...props}
    />
  );
}

// White matte-gloss ceramic material for the body.
function Ceramic(props) {
  return <meshPhysicalMaterial color="#f6f7fb" roughness={0.2} metalness={0.1} clearcoat={0.6} clearcoatRoughness={0.2} {...props} />;
}

function Eye({ side, kind, starGeo }) {
  // side: -1 left, +1 right
  const x = 0.17 * side;
  if (kind === 'star') {
    return (
      <mesh position={[x, 0.06, 0.42]} geometry={starGeo}>
        <GlossyPink intensity={3.2} transmission={0.2} />
      </mesh>
    );
  }
  if (kind === 'closed') {
    // a calm, sleepy closed eye — a flat glossy-pink bar
    return (
      <mesh position={[x, 0.05, 0.42]} scale={[0.11, 0.02, 0.05]}>
        <sphereGeometry args={[1, 20, 12]} />
        <GlossyPink intensity={2.2} transmission={0.2} />
      </mesh>
    );
  }
  return (
    <mesh position={[x, 0.04, 0.42]} scale={[0.06, 0.11, 0.05]}>
      <sphereGeometry args={[1, 24, 24]} />
      <GlossyPink intensity={2.8} transmission={0.3} />
    </mesh>
  );
}

// Floating "z z z" above her head while sleeping.
function Zzz() {
  const ref = useRef();
  useFrame((state) => {
    if (ref.current) ref.current.position.y = 1.1 + Math.sin(state.clock.elapsedTime * 1.5) * 0.05;
  });
  return (
    <group ref={ref} position={[0.55, 1.1, 0]}>
      <Html center distanceFactor={7} occlude={false}>
        <div style={{ color: '#FF1493', fontWeight: 800, fontSize: 22, textShadow: '0 0 8px rgba(255,20,147,.6)', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          z z z
        </div>
      </Html>
    </group>
  );
}

// Floating confetti for the celebratory state.
function Confetti({ active }) {
  const group = useRef();
  const count = 40;
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: (Math.random() - 0.5) * 3,
        y: Math.random() * 2.5,
        z: (Math.random() - 0.5) * 2,
        s: 0.02 + Math.random() * 0.03,
        vy: 0.4 + Math.random() * 0.6,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 4,
        color: ['#FF1493', '#FF69B4', '#ffd166', '#6aa9ff', '#57e39b'][Math.floor(Math.random() * 5)],
      })),
    []
  );
  const refs = useRef([]);
  useFrame((_, dt) => {
    if (!active) return;
    refs.current.forEach((m, i) => {
      if (!m) return;
      const s = seeds[i];
      m.position.y -= s.vy * dt;
      m.rotation.z += s.vr * dt;
      if (m.position.y < -1.2) m.position.y = 2.6;
    });
  });
  if (!active) return null;
  return (
    <group ref={group}>
      {seeds.map((s, i) => (
        <mesh key={i} ref={(el) => (refs.current[i] = el)} position={[s.x, s.y, s.z]} rotation={[0, 0, s.rot]}>
          <boxGeometry args={[s.s, s.s * 0.5, s.s]} />
          <meshStandardMaterial color={s.color} emissive={s.color} emissiveIntensity={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function StatusIcon({ icon }) {
  if (icon === 'cloud') {
    return (
      <Html position={[0.9, 1.15, 0]} center distanceFactor={6} transform occlude={false}>
        <div className="rounded-2xl bg-white/95 px-3 py-2 text-2xl shadow-lg">💭</div>
      </Html>
    );
  }
  if (icon === 'question') {
    return (
      <Html position={[0.8, 1.1, 0]} center distanceFactor={6} transform occlude={false}>
        <div className="rounded-full bg-white/95 px-3 py-1 text-3xl font-black text-pink-glow shadow-lg" style={{ color: PINK }}>
          ?
        </div>
      </Html>
    );
  }
  return null;
}

export default function CassieBot({ emotion, hideIcons = false }) {
  const rig = useRef();
  const head = useRef();
  const armL = useRef();
  const armR = useRef();
  const rim = useRef();
  const starGeo = useMemo(() => makeStarGeometry(), []);

  const pose = emotion.pose;
  const rimTarget = useMemo(() => new THREE.Color(pose.rimColor), [pose.rimColor]);

  useFrame((state, dt) => {
    const t = Math.min(1, dt * 6); // smoothing factor
    const time = state.clock.elapsedTime;

    // idle float + emotion jump
    if (rig.current) {
      const floatY = Math.sin(time * 1.6) * 0.04;
      const jumpY = pose.jump * (0.6 + 0.4 * Math.abs(Math.sin(time * 4)));
      rig.current.position.y = lerp(rig.current.position.y, floatY + jumpY, t);
      rig.current.rotation.y = Math.sin(time * 0.6) * 0.15;
    }
    if (head.current) {
      head.current.rotation.x = lerp(head.current.rotation.x, pose.headX, t);
      head.current.rotation.z = lerp(head.current.rotation.z, pose.headZ, t);
    }
    if (armL.current) armL.current.rotation.z = lerp(armL.current.rotation.z, pose.armL, t);
    if (armR.current) armR.current.rotation.z = lerp(armR.current.rotation.z, pose.armR, t);
    if (rim.current) rim.current.color.lerp(rimTarget, t);
  });

  return (
    <group ref={rig} position={[0, 0, 0]}>
      {/* rim light that tints per emotion */}
      <pointLight ref={rim} position={[0, 0.5, -1.8]} intensity={18} distance={8} color={pose.rimColor} />

      {/* HEAD */}
      <group ref={head} position={[0, 0.55, 0]}>
        {/* antennae */}
        {[-1, 1].map((s) => (
          <group key={s} position={[0.22 * s, 0.5, 0]} rotation={[0, 0, -0.3 * s]}>
            <mesh position={[0, 0.12, 0]}>
              <cylinderGeometry args={[0.018, 0.018, 0.28, 12]} />
              <Ceramic color="#d9dbe6" />
            </mesh>
            <mesh position={[0, 0.28, 0]}>
              <sphereGeometry args={[0.05, 16, 16]} />
              <GlossyPink intensity={2.8} transmission={0.2} />
            </mesh>
          </group>
        ))}

        {/* side ears */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0.52 * s, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 0.12, 24]} />
            <Ceramic />
          </mesh>
        ))}

        {/* head shell */}
        <RoundedBox args={[1, 0.82, 0.7]} radius={0.28} smoothness={6} castShadow receiveShadow>
          <Ceramic />
        </RoundedBox>

        {/* dark screen face */}
        <RoundedBox args={[0.78, 0.6, 0.12]} radius={0.22} smoothness={5} position={[0, 0, 0.32]}>
          <meshPhysicalMaterial color="#101018" roughness={0.15} metalness={0.3} clearcoat={1} clearcoatRoughness={0.05} />
        </RoundedBox>

        {/* eyes */}
        <Eye side={-1} kind={pose.eyes} starGeo={starGeo} />
        <Eye side={1} kind={pose.eyes} starGeo={starGeo} />
      </group>

      {/* BODY */}
      <RoundedBox args={[0.86, 0.7, 0.6]} radius={0.26} smoothness={6} position={[0, -0.15, 0]} castShadow receiveShadow>
        <Ceramic />
      </RoundedBox>

      {/* glowing chest core */}
      <mesh position={[0, -0.12, 0.34]}>
        <sphereGeometry args={[0.12, 32, 32]} />
        <GlossyPink intensity={3} transmission={0.3} />
      </mesh>

      {/* ARMS (pivot at shoulder) */}
      <group ref={armL} position={[-0.5, 0.05, 0]}>
        <mesh position={[0, -0.24, 0]} castShadow>
          <capsuleGeometry args={[0.09, 0.34, 8, 16]} />
          <Ceramic />
        </mesh>
        <mesh position={[0, -0.5, 0]} castShadow>
          <sphereGeometry args={[0.12, 20, 20]} />
          <Ceramic />
        </mesh>
      </group>
      <group ref={armR} position={[0.5, 0.05, 0]}>
        <mesh position={[0, -0.24, 0]} castShadow>
          <capsuleGeometry args={[0.09, 0.34, 8, 16]} />
          <Ceramic />
        </mesh>
        <mesh position={[0, -0.5, 0]} castShadow>
          <sphereGeometry args={[0.12, 20, 20]} />
          <Ceramic />
        </mesh>
      </group>

      <Confetti active={pose.confetti} />
      {pose.icon === 'zzz' && <Zzz />}
      {!hideIcons && pose.icon !== 'zzz' && <StatusIcon icon={pose.icon} />}
    </group>
  );
}

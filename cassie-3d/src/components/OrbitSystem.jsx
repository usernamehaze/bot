import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import * as THREE from 'three';
import { PINK, PINK_SOFT } from './constants';

// A thin glossy-pink torus ring at an arbitrary orientation.
function Ring({ radius, tube = 0.012, rotation, speed = 0.2, dim = false }) {
  const ref = useRef();
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.z += speed * dt;
  });
  return (
    <mesh ref={ref} rotation={rotation}>
      <torusGeometry args={[radius, tube, 16, 160]} />
      <meshPhysicalMaterial
        color={PINK}
        emissive={PINK}
        emissiveIntensity={dim ? 0.8 : 2.2}
        roughness={0.15}
        metalness={0.1}
        clearcoat={1}
        clearcoatRoughness={0.1}
        transparent
        opacity={dim ? 0.5 : 0.9}
      />
    </mesh>
  );
}

// Small glowing nodes scattered on a sphere shell.
function Nodes({ count = 26, radius = 1.55 }) {
  const positions = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      // even-ish distribution on a sphere (golden spiral)
      const y = 1 - (i / (count - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = i * 2.399963;
      arr.push([Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius]);
    }
    return arr;
  }, [count, radius]);

  const group = useRef();
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += 0.15 * dt;
  });

  return (
    <group ref={group}>
      {positions.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[i % 5 === 0 ? 0.028 : 0.018, 12, 12]} />
          <meshPhysicalMaterial color={PINK_SOFT} emissive={PINK_SOFT} emissiveIntensity={2.4} roughness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

// The glowing glossy-pink radiant core.
function Core() {
  const ref = useRef();
  useFrame((state) => {
    const s = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.05;
    if (ref.current) ref.current.scale.setScalar(s);
  });
  return (
    <Float speed={2} floatIntensity={0.25} rotationIntensity={0.2}>
      <mesh ref={ref}>
        <sphereGeometry args={[0.6, 64, 64]} />
        <meshPhysicalMaterial
          color={PINK}
          emissive={PINK}
          emissiveIntensity={3.2}
          roughness={0.1}
          metalness={0.2}
          clearcoat={1}
          clearcoatRoughness={0.05}
          transmission={0.35}
          thickness={0.8}
        />
      </mesh>
      {/* soft halo */}
      <mesh>
        <sphereGeometry args={[0.85, 32, 32]} />
        <meshBasicMaterial color={PINK} transparent opacity={0.12} />
      </mesh>
    </Float>
  );
}

export default function OrbitSystem() {
  const group = useRef();
  useFrame((_, dt) => {
    if (group.current) {
      group.current.rotation.y += 0.25 * dt;
      group.current.rotation.x = Math.sin(Date.now() * 0.0002) * 0.15;
    }
  });

  // a wireframe "mandala" of rings at varied orientations
  const rings = useMemo(
    () => [
      { radius: 1.55, rotation: [0, 0, 0.1], speed: 0.25 },
      { radius: 1.55, rotation: [Math.PI / 2.4, 0, 0.5], speed: -0.18, dim: true },
      { radius: 1.55, rotation: [Math.PI / 3, Math.PI / 4, 0], speed: 0.2 },
      { radius: 1.35, rotation: [Math.PI / 2, 0, 0], speed: -0.3, dim: true },
      { radius: 1.55, rotation: [Math.PI / 5, -Math.PI / 3, 0.2], speed: 0.22 },
      { radius: 1.2, rotation: [Math.PI / 2.8, Math.PI / 2, 0], speed: 0.28, dim: true },
      { radius: 1.55, rotation: [-Math.PI / 3.5, Math.PI / 6, 0], speed: -0.2 },
    ],
    []
  );

  return (
    <group ref={group}>
      {rings.map((r, i) => (
        <Ring key={i} {...r} />
      ))}
      <Nodes />
      <Core />
    </group>
  );
}

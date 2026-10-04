// A stage for promo videos: several felt Cassies in one scene, rendered one frame
// at a time (frameloop "never" + advance(t)) so a video can be captured frame-exact.
//   CassieStage.mount(el) → set(actors) → frame(seconds)
//   actor: { id, outfit, mood, x, y, z, s, ry, rz, facing, accent, shadow }
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Canvas, advance } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import FuzzyCassie from './components/FuzzyCassie';

let setActorsRef = null;
let ready = false;

function Shadow({ s = 1 }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,.42)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.66, 0]} scale={[1.7 * s, 1.1 * s, 1]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} />
    </mesh>
  );
}

function Stage() {
  const [actors, setActors] = useState([]);
  setActorsRef = setActors;
  return (
    <Canvas frameloop="never" dpr={1} camera={{ position: [0, 0.35, 9], fov: 30 }}
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
      style={{ position: 'absolute', inset: 0, background: 'transparent' }}
      onCreated={() => { ready = true; }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2.5, 4, 5]} intensity={2.1} color="#fff4ea" />
      <directionalLight position={[-3, 2, 3]} intensity={0.6} color="#cfe0ff" />
      {actors.map((a) => (
        <group key={a.id} position={[a.x || 0, a.y || 0, a.z || 0]} scale={a.s == null ? 1 : a.s} rotation={[0, a.ry || 0, a.rz || 0]} visible={a.s !== 0}>
          <FuzzyCassie mood={a.mood || 'neutral'} outfit={a.outfit || 'classic'} facing={a.facing || 1} accent={a.accent || null} />
          {a.shadow !== false && <Shadow />}
        </group>
      ))}
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={2.2} color="#ffffff" position={[0, 2, 3]} scale={[6, 4, 1]} />
        <Lightformer intensity={1.2} color="#ffe8d6" position={[-3, 1, 2]} scale={[3, 3, 1]} />
      </Environment>
    </Canvas>
  );
}

window.CassieStage = {
  mount(el) { createRoot(el).render(<Stage />); },
  isReady: () => ready && !!setActorsRef,
  set(actors) { flushSync(() => setActorsRef(actors)); },
  frame(t) { advance(t); },
};

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import CassieBot from './components/CassieBot';
import { EMOTIONS } from './components/constants';

// A compact, transparent 3D Cassie that drops into the vanilla tutor's mascot
// spot. It exposes window.CassieMascot.setEmotion(name) so app.js can drive it
// from the existing emotion / thinking / celebrate / sleep logic.
function Mascot() {
  const [key, setKey] = useState('neutral');
  const [accent, setAccent] = useState(null);

  useEffect(() => {
    window.CassieMascot = window.CassieMascot || {};
    window.CassieMascot.setEmotion = (name) => setKey(EMOTIONS[name] ? name : 'neutral');
    // Let the app tint Cassie to the user's favorite colour (or null = pink).
    window.CassieMascot.setColor = (hex) => setAccent(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(hex || '') ? hex : null);
    window.CassieMascot.ready = true;
    window.dispatchEvent(new Event('cassie3d-ready'));
    return () => {
      if (window.CassieMascot) { window.CassieMascot.setEmotion = null; window.CassieMascot.setColor = null; }
    };
  }, []);

  const emotion = EMOTIONS[key] || EMOTIONS.neutral;
  const keyLight = accent || '#FF1493';

  return (
    <Canvas
      camera={{ position: [0, 0.1, 4.4], fov: 40 }}
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: false }}
      style={{ background: 'transparent', pointerEvents: 'none' }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 4, 4]} intensity={2.2} color={keyLight} />
      <directionalLight position={[-3, 2, 2]} intensity={0.7} color="#88aaff" />
      {/* scaled to leave head-room so raised / open arms stay inside the frame */}
      <group scale={1.02} position={[0, -0.1, 0]}>
        <CassieBot emotion={emotion} hideIcons accent={accent} feet={key !== 'neutral'} />
      </group>
      <Environment resolution={128}>
        <Lightformer intensity={2} color="#ffffff" position={[0, 2, 2]} scale={[6, 6, 1]} />
        <Lightformer intensity={1.4} color={keyLight} position={[-3, 1, 2]} scale={[3, 3, 1]} />
      </Environment>
    </Canvas>
  );
}

const el = document.getElementById('cassie-3d-root');
if (el) createRoot(el).render(<Mascot />);

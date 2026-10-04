import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import FuzzyCassie, { OUTFITS, MOODS } from './components/FuzzyCassie';

// A compact, transparent 3D Cassie — a little felt creature — for the app's mascot
// spot and the landing page. window.CassieMascot drives it:
//   setEmotion(name)  neutral | happy | thinking | encouraging | celebratory | curious | sleep |
//                     angry | dizzy | walk | peek | typing
//   setFacing(dir)    -1 left · 1 right (which way she walks)
//   setOutfit(name)   classic | professor | graduate | coder | heart
//   setColor(hex)     tints the classic blob to the student's favourite colour (null = red)
function Mascot() {
  const [key, setKey] = useState('neutral');
  const [outfit, setOutfit] = useState('classic');
  const [accent, setAccent] = useState(null);
  const [facing, setFacing] = useState(1);

  useEffect(() => {
    const M = (window.CassieMascot = window.CassieMascot || {});
    M.setEmotion = (name) => setKey(MOODS[name] ? name : 'neutral');
    M.setFacing = (dir) => setFacing(dir < 0 ? -1 : 1);
    M.moods = Object.keys(MOODS);
    M.setOutfit = (name) => setOutfit(OUTFITS[name] ? name : 'classic');
    M.setColor = (hex) => setAccent(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(hex || '') ? hex : null);
    M.outfits = Object.keys(OUTFITS);
    M.ready = true;
    window.dispatchEvent(new Event('cassie3d-ready'));
    return () => { M.setEmotion = M.setOutfit = M.setColor = M.setFacing = null; };
  }, []);

  return (
    <Canvas camera={{ position: [0, 0.15, 4.4], fov: 40 }} dpr={[1, 1.75]}
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: false }}
      style={{ background: 'transparent', pointerEvents: 'none' }}>
      <ambientLight intensity={0.55} />
      <directionalLight position={[2.5, 4, 4]} intensity={2.1} color="#fff4ea" />
      <directionalLight position={[-3, 2, 2]} intensity={0.6} color="#cfe0ff" />
      {/* scaled so the cap / beret and raised paws stay inside the frame */}
      <group scale={1.32} position={[0, -0.18, 0]}>
        <FuzzyCassie mood={key} outfit={outfit} accent={accent} facing={facing} />
      </group>
      <Environment resolution={128}>
        <Lightformer intensity={2.2} color="#ffffff" position={[0, 2, 3]} scale={[6, 4, 1]} />
        <Lightformer intensity={1.2} color="#ffe8d6" position={[-3, 1, 2]} scale={[3, 3, 1]} />
      </Environment>
    </Canvas>
  );
}

function mountMascot(el) {
  if (!el || el.__cassieRoot) return;
  el.__cassieRoot = createRoot(el);
  el.__cassieRoot.render(<Mascot />);
}
window.CassieMascot = window.CassieMascot || {};
window.CassieMascot.mount = mountMascot;
mountMascot(document.getElementById('cassie-3d-root'));

import React, { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Lightformer, ContactShadows, OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { motion } from 'framer-motion';
import CassieBot from './CassieBot';
import { EMOTIONS, EMOTION_ORDER, PINK } from './constants';

export default function BotShowcase({ onBack }) {
  const [emotionKey, setEmotionKey] = useState('neutral');
  const emotion = EMOTIONS[emotionKey];

  return (
    <motion.div
      className="flex h-full w-full flex-col bg-charcoal text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* header */}
      <header className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: PINK, boxShadow: `0 0 12px ${PINK}` }} />
          <span className="text-lg font-bold">Cassie</span>
        </div>
        <button onClick={onBack} className="text-sm text-white/50 transition hover:text-white">
          ← loading screen
        </button>
      </header>

      {/* 3D stage */}
      <div className="relative min-h-0 flex-1">
        <Canvas shadows camera={{ position: [0, 0.3, 4.2], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true }}>
          <color attach="background" args={['#121214']} />
          <ambientLight intensity={0.5} />
          <directionalLight
            castShadow
            position={[3, 5, 4]}
            intensity={2.4}
            color={PINK}
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-bias={-0.0003}
          />
          <directionalLight position={[-4, 3, 2]} intensity={0.8} color="#88aaff" />

          <CassieBot emotion={emotion} />

          <ContactShadows position={[0, -0.95, 0]} opacity={0.5} scale={6} blur={2.6} far={2.5} color="#000000" />
          {/* in-scene environment (no network fetch) for a glossy ceramic finish */}
          <Environment resolution={256}>
            <Lightformer intensity={2.4} color="#ffffff" position={[0, 3, 2]} scale={[8, 8, 1]} />
            <Lightformer intensity={1.6} color={PINK} position={[-4, 1, 2]} scale={[4, 4, 1]} />
            <Lightformer intensity={1.0} color="#88aaff" position={[4, 0, 2]} scale={[4, 4, 1]} />
          </Environment>
          <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI / 1.9} />

          <EffectComposer>
            <Bloom intensity={0.9} luminanceThreshold={0.35} luminanceSmoothing={0.9} mipmapBlur radius={0.6} />
          </EffectComposer>
        </Canvas>

        {/* current emotion label overlay */}
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 text-center">
          <motion.div key={emotion.key} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-sm tracking-[0.25em] text-white/70">
            {emotion.label.toUpperCase()}
          </motion.div>
        </div>
      </div>

      {/* emotion grid */}
      <div className="px-4 pb-6 pt-2">
        <p className="mb-3 text-center text-xs uppercase tracking-[0.2em] text-white/40">Tap an emotion</p>
        <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-5">
          {EMOTION_ORDER.map((key) => {
            const e = EMOTIONS[key];
            const active = key === emotionKey;
            return (
              <motion.button
                key={key}
                onClick={() => setEmotionKey(key)}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.96 }}
                className={`flex flex-col items-center gap-1 rounded-2xl border px-3 py-3 text-center transition ${
                  active ? 'border-transparent text-white' : 'border-white/10 text-white/70 hover:border-white/25'
                }`}
                style={active ? { background: PINK, boxShadow: `0 8px 30px ${PINK}55` } : { background: 'rgba(255,255,255,0.04)' }}
              >
                <span className="text-2xl">{e.emoji}</span>
                <span className="text-sm font-semibold">{e.label}</span>
                <span className={`text-[11px] leading-tight ${active ? 'text-white/90' : 'text-white/40'}`}>{e.blurb}</span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

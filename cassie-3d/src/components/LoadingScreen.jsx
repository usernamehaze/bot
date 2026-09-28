import React from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { motion } from 'framer-motion';
import OrbitSystem from './OrbitSystem';
import { PINK } from './constants';

export default function LoadingScreen({ onEnter }) {
  return (
    <motion.div
      className="relative h-full w-full cursor-pointer select-none bg-charcoal"
      onClick={onEnter}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.6 }}
    >
      {/* 3D orbit / mandala */}
      <div className="absolute inset-0">
        <Canvas camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true }}>
          <color attach="background" args={['#121214']} />
          <ambientLight intensity={0.4} />
          <pointLight position={[3, 2, 4]} intensity={40} color={PINK} distance={20} />
          <pointLight position={[-4, -2, 2]} intensity={15} color="#7a5cff" distance={20} />
          <OrbitSystem />
          {/* in-scene environment (no network fetch) for glossy reflections */}
          <Environment resolution={256}>
            <Lightformer intensity={2.2} color="#ffffff" position={[0, 2, -3]} scale={[8, 8, 1]} />
            <Lightformer intensity={1.6} color={PINK} position={[-4, 1, 2]} scale={[4, 4, 1]} />
            <Lightformer intensity={1.1} color="#7a5cff" position={[4, -1, 2]} scale={[4, 4, 1]} />
          </Environment>
          <EffectComposer>
            <Bloom intensity={1.1} luminanceThreshold={0.2} luminanceSmoothing={0.9} mipmapBlur radius={0.7} />
          </EffectComposer>
        </Canvas>
      </div>

      {/* overlay title */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-end pb-[16vh]">
        <div className="flex items-center gap-2 text-white">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Cassie</h1>
          <motion.span
            className="text-2xl"
            style={{ color: PINK }}
            animate={{ scale: [0.85, 1.15, 0.85], rotate: [0, 25, 0], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            ✦
          </motion.span>
        </div>
        <motion.p
          className="mt-2 text-sm tracking-[0.2em] text-white/60"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        >
          thinking
          <span className="ml-0.5">
            <span className="animate-[pulseDot_1.4s_infinite]">.</span>
            <span className="animate-[pulseDot_1.4s_infinite] [animation-delay:0.2s]">.</span>
            <span className="animate-[pulseDot_1.4s_infinite] [animation-delay:0.4s]">.</span>
          </span>
        </motion.p>
      </div>

      {/* enter hint */}
      <motion.div
        className="pointer-events-none absolute inset-x-0 bottom-8 text-center text-xs tracking-wide text-white/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 0.6 }}
      >
        tap anywhere to enter
      </motion.div>
    </motion.div>
  );
}

import React, { Suspense, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import LoadingScreen from './components/LoadingScreen';
import BotShowcase from './components/BotShowcase';

export default function App() {
  const [screen, setScreen] = useState('loading'); // 'loading' | 'bot'

  return (
    <div className="h-full w-full overflow-hidden bg-charcoal">
      <Suspense fallback={<div className="flex h-full w-full items-center justify-center text-white/60">Loading…</div>}>
        <AnimatePresence mode="wait">
          {screen === 'loading' ? (
            <LoadingScreen key="loading" onEnter={() => setScreen('bot')} />
          ) : (
            <BotShowcase key="bot" onBack={() => setScreen('loading')} />
          )}
        </AnimatePresence>
      </Suspense>
    </div>
  );
}

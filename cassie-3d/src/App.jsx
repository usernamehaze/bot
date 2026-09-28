import React, { Suspense, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import LoadingScreen from './components/LoadingScreen';
import BotShowcase from './components/BotShowcase';

// SITE mode (VITE_SITE=1): this build is the loading screen for the main
// Cassie site, so "enter" navigates to the real tutor app (app.html) instead
// of the in-app 3D bot showcase used during local development.
const SITE = import.meta.env.VITE_SITE === '1';

export default function App() {
  const [screen, setScreen] = useState('loading'); // 'loading' | 'bot'

  function enter() {
    if (SITE) {
      window.location.href = 'app.html';
    } else {
      setScreen('bot');
    }
  }

  // In site mode, auto-continue to the app after the animation has played.
  useEffect(() => {
    if (!SITE) return;
    const t = setTimeout(enter, 9000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="h-full w-full overflow-hidden bg-charcoal">
      <Suspense fallback={<div className="flex h-full w-full items-center justify-center text-white/60">Loading…</div>}>
        <AnimatePresence mode="wait">
          {screen === 'loading' ? (
            <LoadingScreen key="loading" onEnter={enter} />
          ) : (
            <BotShowcase key="bot" onBack={() => setScreen('loading')} />
          )}
        </AnimatePresence>
      </Suspense>
    </div>
  );
}

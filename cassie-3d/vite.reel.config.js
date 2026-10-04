import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The promo-video stage (several felt Cassies, frame-exact) → ../promo/reel/cassie-stage.js
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: '../promo/reel/build',
    emptyOutDir: true,
    lib: { entry: 'src/reel-stage.jsx', name: 'CassieStageBundle', formats: ['iife'], fileName: () => 'cassie-stage.js' },
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The landing page's ShaderGradient background as one self-contained IIFE bundle.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist-landing',
    emptyOutDir: true,
    lib: { entry: 'src/landing-bg.jsx', name: 'CassieGradientBundle', formats: ['iife'], fileName: () => 'cassie-gradient.js' },
    rollupOptions: { external: ['framer'], output: { globals: { framer: 'Framer' } } },
  },
});
